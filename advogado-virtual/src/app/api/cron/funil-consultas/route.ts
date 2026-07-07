import { NextResponse } from 'next/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { logger } from '@/lib/logger'
import { sincronizarProcessos } from '@/lib/processos/sync'
import { sincronizarPublicacoesDjen } from '@/lib/processos/djen'

export const maxDuration = 60

// GET /api/cron/funil-consultas — job diário (Vercel Cron). Marca as consultas
// cujo horário já passou como "aguardando confirmação" (spec §5) — o humano
// confirma presença (→ consulta realizada) ou não (→ novo lead). Fail-closed
// por CRON_SECRET (a Vercel injeta o Bearer automaticamente).
export async function GET(req: Request) {
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

  // Fase 5 — sincroniza processos de clientes VIP com o DataJud (isolado: uma
  // falha aqui não derruba o job do funil). Orçamento repartido no maxDuration=60.
  let processos: { processos: number; novosMovimentos: number; consultados: number } | null = null
  try {
    processos = await sincronizarProcessos(admin, { deadlineMs: 30_000 })
  } catch (e) {
    logger.error('cron.processos_sync.falha', {}, e as Error)
  }

  // Fase 5 (complemento) — publicações do DJEN por OAB (D+1, com inteiro teor).
  // Também isolado; 1ª execução por tenant = backfill silencioso (não notifica).
  let djen: { tenants: number; casadas: number; novas: number; enviados: number; pendentes: number } | null = null
  try {
    djen = await sincronizarPublicacoesDjen(admin, { deadlineMs: 18_000 })
  } catch (e) {
    logger.error('cron.djen_sync.falha', {}, e as Error)
  }

  return NextResponse.json({ ok: true, marcados: n, processos, djen })
}
