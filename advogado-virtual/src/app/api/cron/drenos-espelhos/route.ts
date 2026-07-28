import { NextResponse } from 'next/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { logger } from '@/lib/logger'
import { processarFilaDrive } from '@/lib/drive/espelho'
import { processarFilaCalendar } from '@/lib/calendar/espelho'

// Cron dedicado dos espelhos Google (Vercel PRO, 2026-07-28): drena as filas de
// Drive e Calendar a cada 15 minutos — no Hobby elas viviam de after() pós-
// mutação + folga do cron diário + botão. Os dois drenos são no-op com espelho
// inerte e têm dead-letter próprio (tentativas ≥ 8 ficam de fora). A folga do
// cron diário segue como backstop. Autenticado por CRON_SECRET (fail-closed).
export const maxDuration = 120

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET
  if (!secret || req.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Não autorizado' }, { status: 401 })
  }

  const admin = createAdminClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
  const t0 = Date.now()

  let drive: { clientes: number; arquivos: number; erros: number } | null = null
  try {
    const r = await processarFilaDrive(admin, { deadline: Math.min(t0 + 60_000, t0 + 110_000) })
    drive = { clientes: r.clientes, arquivos: r.arquivos, erros: r.erros }
  } catch (e) {
    logger.error('cron.drenos.drive_falha', {}, e as Error)
  }

  let calendar: { usuarios: number; upserts: number; remocoes: number; erros: number } | null = null
  try {
    const deadline = Math.min(Date.now() + 45_000, t0 + 115_000)
    if (deadline > Date.now() + 3_000) {
      const r = await processarFilaCalendar(admin, { deadline })
      calendar = { usuarios: r.usuarios, upserts: r.upserts, remocoes: r.remocoes, erros: r.erros }
    }
  } catch (e) {
    logger.error('cron.drenos.calendar_falha', {}, e as Error)
  }

  return NextResponse.json({ ok: true, drive, calendar })
}
