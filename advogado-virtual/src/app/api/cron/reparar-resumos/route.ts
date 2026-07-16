import { NextResponse } from 'next/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { repararResumos } from '@/lib/processos/reparo'

export const maxDuration = 300

// GET /api/cron/reparar-resumos — gera os resumo_ia que faltam (ver
// lib/processos/reparo.ts). SEM agendamento próprio: o plano Hobby da Vercel
// limita a 2 crons diários, então o reparo roda na folga do cron
// funil-consultas; esta rota fica para disparo manual/backfill com o
// CRON_SECRET (fail-closed, sem fallback de sessão).
export async function GET(req: Request) {
  const t0 = Date.now()
  const secret = process.env.CRON_SECRET
  if (!secret || req.headers.get('authorization') !== `Bearer ${secret}`) {
    return new NextResponse('Unauthorized', { status: 401 })
  }

  const admin = createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )

  // Teto ~250s desde t0 — margem sob o maxDuration=300 (a Vercel mata em 300s).
  const resultado = await repararResumos(admin, { deadline: t0 + 250_000 })
  return NextResponse.json({ ok: true, ...resultado })
}
