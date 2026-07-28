import { NextResponse } from 'next/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { logger } from '@/lib/logger'
import {
  backfillLote,
  progressoBackfill,
  type BackfillResultado,
} from '@/lib/conversas-acervo/backfill'

// Cron TEMPORÁRIO do backfill do histórico do Chatwoot para o acervo próprio
// (plano Conversas Próprias — etapa antecipada por decisão do dono). Cada tick
// importa uma página de conversas do cursor durável (migration 084) e para no
// deadline; quando TODOS os cursores concluem, a rota vira no-op barato (duas
// queries) e a entrada do vercel.json pode sair.
// Autenticado por CRON_SECRET (fail-closed). LGPD: só contagens e cursores.
//
// RITMO: o lote espaça as chamadas ao relay (ESPACO_RELAY_MS) para não queimar o
// limite de 120 req/min por IP que a tela /conversas e o cron do reconciliador
// também usam. Por isso o backfill é DEVAGAR de propósito — algumas horas de
// ticks, não minutos. O progresso legível vem no corpo da resposta.
export const maxDuration = 300

/** Folga entre o deadline do trabalho e o maxDuration da função. */
const ORCAMENTO_MS = 280_000

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET
  if (!secret || req.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Não autorizado' }, { status: 401 })
  }

  const tenantId = process.env.FUNIL_TENANT_ID
  if (!tenantId) {
    return NextResponse.json({ error: 'FUNIL_TENANT_ID não configurado' }, { status: 500 })
  }

  const admin = createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )

  let resultado: BackfillResultado | null = null
  try {
    resultado = await backfillLote(admin, { tenantId, deadline: Date.now() + ORCAMENTO_MS })
  } catch (e) {
    // backfillLote nunca lança; cinto e suspensório.
    logger.error('cron.backfill_conversas.falha', {}, e as Error)
  }

  const progresso = await progressoBackfill(admin, tenantId)
  return NextResponse.json({
    ok: true,
    concluido: resultado?.concluido ?? progresso?.concluido ?? false,
    resultado,
    progresso,
  })
}
