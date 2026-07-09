import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { getAuthContext, requireRole } from '@/lib/auth'
import { validateBody } from '@/lib/api'
import { logger } from '@/lib/logger'
import { reprocessarPublicacoesDjen } from '@/lib/processos/djen'

export const maxDuration = 60

// Diferença em dias corridos entre duas datas YYYY-MM-DD (ancorada em UTC,
// imune a horário de verão). Assume a <= b para o resultado ser não-negativo.
function diffDias(a: string, b: string): number {
  const [ay, am, ad] = a.split('-').map(Number)
  const [by, bm, bd] = b.split('-').map(Number)
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86_400_000)
}

const schema = z
  .object({
    dataInicio: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use o formato YYYY-MM-DD'),
    dataFim: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use o formato YYYY-MM-DD'),
  })
  // Comparação lexical funciona para YYYY-MM-DD.
  .refine((d) => d.dataInicio <= d.dataFim, {
    message: 'dataInicio deve ser anterior ou igual a dataFim',
    path: ['dataInicio'],
  })
  .refine((d) => diffDias(d.dataInicio, d.dataFim) <= 90, {
    message: 'A janela não pode exceder 90 dias',
    path: ['dataFim'],
  })

// POST /api/cron/captura-publicacoes — reprocessamento MANUAL de publicações do
// DJEN numa janela explícita {dataInicio, dataFim}. Semântica de backfill: NÃO
// avança a marca d'água e NUNCA notifica clientes (o reprocessador cuida disso).
//
// NÃO entra no vercel.json: o agendamento diário continua no funil-consultas.
// Esta rota é acionada sob demanda — daí a dupla autenticação abaixo.
//
// Auth: aceita (a) Bearer ${CRON_SECRET} — para chamadas automatizadas — OU
// (b) sessão de usuário com papel admin — para o disparo manual pela UI.
//
// ESCOPO (invariante f, isolamento multi-tenant): 'admin' é papel POR TENANT, não
// super-admin de plataforma. O disparo por sessão admin reprocessa APENAS o tenant
// do próprio admin (tenantId abaixo); só o bearer CRON_SECRET (operação de
// plataforma) reprocessa TODOS os tenants.
export async function POST(req: Request) {
  const secret = process.env.CRON_SECRET
  const bearerOk = !!secret && req.headers.get('authorization') === `Bearer ${secret}`

  let tenantId: string | undefined // undefined = todos os tenants (só via bearer)
  if (!bearerOk) {
    const auth = await getAuthContext()
    if (!auth.ok) return auth.response
    const gate = requireRole(auth.usuario, ['admin'])
    if (gate) return gate
    tenantId = auth.usuario.tenant_id // sessão admin: escopo do próprio escritório
  }

  const parsed = await validateBody(req, schema)
  if (!parsed.ok) return parsed.response
  const { dataInicio, dataFim } = parsed.data

  const admin = createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )

  try {
    const resumo = await reprocessarPublicacoesDjen(admin, { inicio: dataInicio, fim: dataFim, tenantId })
    // LGPD: só contagens/janela — nunca texto de publicação.
    logger.info('cron.captura_publicacoes.reprocessamento', { inicio: dataInicio, fim: dataFim, ...resumo })
    return NextResponse.json({ ok: true, janela: { inicio: dataInicio, fim: dataFim }, ...resumo })
  } catch (e) {
    logger.error('cron.captura_publicacoes.falha', { inicio: dataInicio, fim: dataFim }, e as Error)
    return NextResponse.json({ erro: 'Falha ao reprocessar publicações' }, { status: 500 })
  }
}
