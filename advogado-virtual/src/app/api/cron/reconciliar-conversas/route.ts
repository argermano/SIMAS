import { NextResponse } from 'next/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { logger } from '@/lib/logger'
import { reconciliarVarredura, type VarreduraResultado } from '@/lib/conversas-acervo/reconciliador'

// Cron dedicado do reconciliador (Vercel PRO, 2026-07-28): a cada 5 minutos
// confirma acervo×Chatwoot e repõe o que a ponte perdeu — substitui o regime
// "carona no tráfego + folga do cron diário" do plano Hobby (a varredura diária
// em funil-consultas segue como cinto e suspensório). Autenticado por
// CRON_SECRET (fail-closed); é no-op com RECONCILIA_CONVERSAS desligado.
export const maxDuration = 60

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET
  if (!secret || req.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Não autorizado' }, { status: 401 })
  }

  const admin = createAdminClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

  let resultado: VarreduraResultado | null = null
  try {
    resultado = await reconciliarVarredura(admin, { deadline: Date.now() + 45_000 })
    logger.info('cron.reconciliar_conversas', { ...resultado })
  } catch (e) {
    // reconciliarVarredura nunca lança; cinto e suspensório.
    logger.error('cron.reconciliar_conversas.falha', {}, e as Error)
  }

  return NextResponse.json({ ok: true, resultado })
}
