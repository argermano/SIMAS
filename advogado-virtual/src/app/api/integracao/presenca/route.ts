import { NextResponse } from 'next/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { jsonError } from '@/lib/api'
import { autorizadoIntegracao } from '@/lib/funil/auth-integracao'
import { hojeSaoPauloISO } from '@/lib/processos/util'
import {
  UNIDADES,
  ROTULO_UNIDADE,
  proximasPresencas,
  type UnidadePresenca,
  type PresencaRow,
} from '@/lib/agenda/presenca'

// GET /api/integracao/presenca?unidade=<slug>&dias=30 — o bot (ai-attendant)
// pergunta em quais datas a advogada estará na unidade. Auth: x-simas-token
// (autorizadoIntegracao). Escopo: FUNIL_TENANT_ID. Decisão do dono: responde
// SÓ unidade + próximas datas (max 5) — sem horários, sem compromissos.
export async function GET(req: Request) {
  if (!autorizadoIntegracao(req)) {
    return new NextResponse('Unauthorized', { status: 401 })
  }

  const tenantId = process.env.FUNIL_TENANT_ID
  if (!tenantId) return jsonError('FUNIL_TENANT_ID não configurado', 500)

  const { searchParams } = new URL(req.url)
  const unidade = searchParams.get('unidade') as UnidadePresenca | null
  if (!unidade || !UNIDADES.includes(unidade)) {
    return jsonError('Parâmetro "unidade" inválido (brasilia|florianopolis|blumenau)', 400)
  }
  const diasParam = Number(searchParams.get('dias') ?? '30')
  const dias = Number.isFinite(diasParam) ? Math.min(Math.max(Math.trunc(diasParam), 1), 180) : 30

  const admin = createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )

  // Advogada principal do tenant; fallback: primeiro advogado ativo.
  const { data: principal } = await admin
    .from('users')
    .select('id, nome')
    .eq('tenant_id', tenantId)
    .eq('status', 'ativo')
    .eq('is_advogado_principal', true)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle()

  let advogada = principal
  if (!advogada) {
    const { data: fallback } = await admin
      .from('users')
      .select('id, nome')
      .eq('tenant_id', tenantId)
      .eq('status', 'ativo')
      .eq('role', 'advogado')
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle()
    advogada = fallback
  }
  if (!advogada) return jsonError('Nenhum advogado encontrado para o tenant', 404)

  // Janela [hoje, hoje + dias] no dia civil de São Paulo.
  const hoje = hojeSaoPauloISO()
  const fim = new Date(`${hoje}T12:00:00Z`)
  fim.setUTCDate(fim.getUTCDate() + dias)
  const ate = fim.toISOString().slice(0, 10)

  const { data: rows, error } = await admin
    .from('presencas')
    .select('data, unidade')
    .eq('tenant_id', tenantId)
    .eq('user_id', advogada.id)
    .gte('data', hoje)
    .lte('data', ate)
    .order('data', { ascending: true })
  if (error) return jsonError('Erro ao consultar presenças', 500)

  const proximas = proximasPresencas((rows ?? []) as PresencaRow[], unidade, hoje, 5)

  return NextResponse.json({
    advogada: advogada.nome,
    unidade,
    rotulo: ROTULO_UNIDADE[unidade],
    proximas,
  })
}
