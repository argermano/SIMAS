import { NextResponse } from 'next/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { logger } from '@/lib/logger'

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
  return NextResponse.json({ ok: true, marcados: n })
}
