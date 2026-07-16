import { NextResponse } from 'next/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { logger } from '@/lib/logger'
import { sincronizarProcessos } from '@/lib/processos/sync'
import { sincronizarPublicacoesDjen } from '@/lib/processos/djen'
import { alertarFalhaPublicacoes } from '@/lib/processos/alertas'
import { rodarSentinela, type SentinelaResultado } from '@/lib/processos/sentinela'

export const maxDuration = 300

// GET /api/cron/funil-consultas — job diário (Vercel Cron). Marca as consultas
// cujo horário já passou como "aguardando confirmação" (spec §5) — o humano
// confirma presença (→ consulta realizada) ou não (→ novo lead). Fail-closed
// por CRON_SECRET (a Vercel injeta o Bearer automaticamente).
export async function GET(req: Request) {
  // Âncora do orçamento de tempo do handler (maxDuration=300). Etapas sob o teto:
  // 60s sync VIP + 60s DJEN + drain SÓ-pendentes (deadline clampado a t0+270s) + 8s
  // sentinela (cap t0+290s) — cada tail respeita um teto relativo a t0, então o
  // handler nunca é morto pela Vercel no meio.
  const t0 = Date.now()
  const secret = process.env.CRON_SECRET
  if (!secret || req.headers.get('authorization') !== `Bearer ${secret}`) {
    return new NextResponse('Unauthorized', { status: 401 })
  }

  const admin = createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )

  const agora = new Date().toISOString()
  const { data, error } = await admin
    .from('funil_leads')
    .update({ aguardando_confirmacao: true, updated_at: agora })
    .eq('etapa', 'consulta_agendada')
    .eq('aguardando_confirmacao', false)
    .eq('consulta_cancelada', false)
    .lt('consulta_data', agora)
    .not('consulta_data', 'is', null)
    .select('id')

  if (error) {
    logger.error('cron.funil_consultas.falha', {}, error)
    return NextResponse.json({ erro: error.message }, { status: 500 })
  }

  const n = data?.length ?? 0
  logger.info('cron.funil_consultas', { aguardandoConfirmacao: n })

  // Fase 5 — recupera avisos ÓRFÃOS: se a função morreu entre o claim
  // (pendente→aprovada) e o envio, a linha ficaria presa em 'aprovada' (invisível
  // na fila). Devolve para 'pendente' → aparece em Movimentações p/ aprovação.
  try {
    const { data: orfaos } = await admin
      .from('processo_movimentos')
      .update({ notif_status: 'pendente' })
      .eq('notif_status', 'aprovada')
      .is('notif_enviada_em', null)
      .lt('created_at', new Date(Date.now() - 30 * 60_000).toISOString())
      .select('id')
    if (orfaos?.length) logger.info('cron.processos_orfaos_recuperados', { n: orfaos.length })
  } catch (e) {
    logger.error('cron.processos_orfaos.falha', {}, e as Error)
  }

  // Fase 5 — sincroniza processos de clientes VIP (e a fila de pendentes deixada
  // por ciclos anteriores) com o DataJud. Isolado: falha aqui não derruba o funil.
  let processos: { processos: number; novosMovimentos: number; consultados: number } | null = null
  try {
    processos = await sincronizarProcessos(admin, { deadlineMs: 60_000 })
  } catch (e) {
    logger.error('cron.processos_sync.falha', {}, e as Error)
  }

  // Fase 5 (complemento) — publicações do DJEN por OAB (D+1, com inteiro teor).
  // Também isolado; 1ª execução por tenant = backfill silencioso (não notifica).
  let djen: { tenants: number; casadas: number; novas: number; enviados: number; pendentes: number } | null = null
  try {
    djen = await sincronizarPublicacoesDjen(admin, { deadlineMs: 60_000 })
  } catch (e) {
    logger.error('cron.djen_sync.falha', {}, e as Error)
    // Alerta a operação (e-mail + Sentry). alertarFalhaPublicacoes nunca lança.
    await alertarFalhaPublicacoes({
      assunto: 'exceção na sincronização de publicações (DJEN)',
      detalhes: `A rodada de captura do DJEN no cron funil-consultas lançou uma exceção:\n\n${e instanceof Error ? `${e.name}: ${e.message}` : String(e)}`,
    })
  }

  // Passada pós-DJEN: drena SÓ a fila sync_pendente (059) que o DJEN acabou de marcar
  // nos processos casados — assim a publicação do dia reflete nos ANDAMENTOS no MESMO
  // ciclo (não espera o cron de amanhã). `somentePendentes` evita re-consultar os VIPs
  // (já sincronizados acima) e dobrar o polling no DataJud. Deadline COM TETO relativo
  // a t0 (≤ t0+270s): o drain nunca empurra o handler além do maxDuration=300 (a Vercel
  // mataria a função). O que não couber fica marcado (fila durável) e é drenado no
  // próximo cron — nada se perde. Isolado.
  let processosDrain: { processos: number; novosMovimentos: number; consultados: number } | null = null
  try {
    const drainMs = Math.max(0, Math.min(120_000, t0 + 270_000 - Date.now()))
    processosDrain = await sincronizarProcessos(admin, { deadlineMs: drainMs, somentePendentes: true })
  } catch (e) {
    logger.error('cron.processos_drain.falha', {}, e as Error)
  }

  // Sentinela DataJud × DJEN — cruza movimentos de publicação (DataJud) sem
  // comunicação correspondente no DJEN e abre alertas internos de triagem.
  // Roda DEPOIS das duas etapas (usa o que elas acabaram de gravar). Isolada:
  // deadline próprio de ~8s e try/catch — NUNCA derruba o cron. A sentinela
  // nunca notifica cliente (WhatsApp) e nunca calcula prazo.
  let sentinela: SentinelaResultado | null = null
  try {
    sentinela = await rodarSentinela(admin, {
      deadline: Math.min(Date.now() + 8_000, t0 + 290_000),
    })
    logger.info('cron.sentinela', { ...sentinela })
  } catch (e) {
    // rodarSentinela já é best-effort (não lança); cinto e suspensório.
    logger.error('cron.sentinela.falha', {}, e as Error)
  }

  return NextResponse.json({ ok: true, marcados: n, processos, djen, processosDrain, sentinela })
}
