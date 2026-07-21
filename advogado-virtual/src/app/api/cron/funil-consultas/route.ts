import { NextResponse } from 'next/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { logger } from '@/lib/logger'
import { sincronizarProcessos } from '@/lib/processos/sync'
import { sincronizarPublicacoesDjen } from '@/lib/processos/djen'
import { alertarFalhaPublicacoes } from '@/lib/processos/alertas'
import { rodarSentinela, type SentinelaResultado } from '@/lib/processos/sentinela'
import { repararResumos, type ReparoResultado } from '@/lib/processos/reparo'
import { processarFilaDrive } from '@/lib/drive/espelho'
import { processarFilaCalendar } from '@/lib/calendar/espelho'

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
  // (pendente→aprovada) e a marca de envio, a linha ficaria presa em 'aprovada'
  // com notif_enviada_em=null (invisível na fila). Devolvê-la a 'pendente' a
  // reabre em Movimentações p/ aprovação.
  // ACHADO 7: 'aprovada'+null NÃO significa "não enviado" — o envio pode ter
  // COMPLETADO e só o UPDATE de status ter falhado/morrido. Reenfileirar cego faz
  // o cliente receber o MESMO aviso 2x. Antes de reenfileirar, reconferimos o
  // registro INDEPENDENTE de entrega na auditoria (logAudit grava
  // 'processo.notificacao_enviada' com metadata.movimento_id LOGO após o envio) e
  // PULAMOS os que já constam entregues — esses ficam como estão.
  try {
    const corteOrfaos = new Date(Date.now() - 30 * 60_000).toISOString()
    const { data: candidatos } = await admin
      .from('processo_movimentos')
      .select('id')
      .eq('notif_status', 'aprovada')
      .is('notif_enviada_em', null)
      .lt('created_at', corteOrfaos)
    const ids = (candidatos ?? []).map((c) => c.id as string)
    if (ids.length) {
      // Sinal de entrega independente do status: linhas de auditoria de envio.
      const { data: entregasLog } = await admin
        .from('audit_log')
        .select('metadata')
        .eq('action', 'processo.notificacao_enviada')
        .in('metadata->>movimento_id', ids)
      const jaEntregues = new Set(
        (entregasLog ?? [])
          .map((e) => (e.metadata as { movimento_id?: string } | null)?.movimento_id)
          .filter((v): v is string => !!v),
      )
      const reenfileirar = ids.filter((id) => !jaEntregues.has(id))
      let recuperados = 0
      if (reenfileirar.length) {
        // Guarda atômica: só reverte quem AINDA está aprovada+não-enviada (um
        // envio concorrente pode ter marcado 'enviada' nesse meio-tempo).
        const { data: orfaos } = await admin
          .from('processo_movimentos')
          .update({ notif_status: 'pendente' })
          .in('id', reenfileirar)
          .eq('notif_status', 'aprovada')
          .is('notif_enviada_em', null)
          .select('id')
        recuperados = orfaos?.length ?? 0
      }
      if (recuperados || jaEntregues.size) {
        logger.info('cron.processos_orfaos_recuperados', { n: recuperados, jaEntregues: jaEntregues.size })
      }
    }
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

  // Reparo de resumos IA na FOLGA do dia (plano Hobby: sem cron próprio — limite
  // de 2 crons diários). Num dia normal as etapas acima terminam bem antes dos
  // tetos, sobrando minutos aqui; num dia cheio o teto t0+285s reduz o reparo a
  // quase nada e o restante fica para amanhã. repararResumos nunca lança.
  let reparo: ReparoResultado | null = null
  const reparoDeadline = Math.min(Date.now() + 180_000, t0 + 285_000)
  if (reparoDeadline > Date.now() + 5_000) {
    reparo = await repararResumos(admin, { deadline: reparoDeadline })
  }

  // Espelho no Google Drive (066) — drena a fila na FOLGA que restar (DEPOIS do
  // reparo). Sem cron próprio (Hobby limita a 2 crons/dia): pega os minutos que
  // sobrarem. Teto duplo: min(90s, t0+295s) — nunca empurra o handler além do
  // maxDuration=300 (a Vercel mataria a função). Só entra se sobrar tempo útil; o
  // que não couber fica na fila durável e é drenado no próximo ciclo / pelo botão.
  // processarFilaDrive é no-op se o espelho está inerte; isolado num try/catch.
  let driveSync: { clientes: number; arquivos: number; erros: number } | null = null
  try {
    const driveDeadline = Math.min(Date.now() + 90_000, t0 + 295_000)
    if (driveDeadline > Date.now() + 3_000) {
      const r = await processarFilaDrive(admin, { deadline: driveDeadline })
      driveSync = { clientes: r.clientes, arquivos: r.arquivos, erros: r.erros }
    }
  } catch (e) {
    logger.error('cron.drive_sync.falha', {}, e as Error)
  }

  // Espelho ATIVO no Google Calendar (068) — drena a fila na folga que restar
  // DEPOIS do Drive. Teto duplo: min(60s, t0+298s) — nunca empurra o handler além
  // do maxDuration=300 (a Vercel mataria a função). processarFilaCalendar é no-op
  // se o espelho está inerte; isolado num try/catch. O que não couber fica na fila
  // durável e é drenado no próximo ciclo / pelo botão "Sincronizar agora".
  let calendarSync: { usuarios: number; upserts: number; remocoes: number; erros: number; delegacaoPendente: number } | null = null
  try {
    const calDeadline = Math.min(Date.now() + 60_000, t0 + 298_000)
    if (calDeadline > Date.now() + 3_000) {
      const r = await processarFilaCalendar(admin, { deadline: calDeadline })
      calendarSync = { usuarios: r.usuarios, upserts: r.upserts, remocoes: r.remocoes, erros: r.erros, delegacaoPendente: r.delegacaoPendente }
    }
  } catch (e) {
    logger.error('cron.calendar_sync.falha', {}, e as Error)
  }

  return NextResponse.json({ ok: true, marcados: n, processos, djen, processosDrain, sentinela, reparo, driveSync, calendarSync })
}
