import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

// Taxa de conversão USD → BRL (atualizar periodicamente)
const USD_BRL = 5.70

/**
 * Categories for endpoint grouping.
 * Dynamic endpoints like `comando_resumir` and `correcao_ortografia` are matched by prefix.
 */
const CATEGORIAS: Record<string, { label: string; grupo: string; chave: string }> = {
  gerar_peca:     { label: 'Geração de peças',         grupo: 'Documentos', chave: 'gerar_peca' },
  refinar_peca:   { label: 'Refinamento de peças',     grupo: 'Documentos', chave: 'refinar_peca' },
  validar_peca:   { label: 'Validação de peças',       grupo: 'Documentos', chave: 'validar_peca' },
  analise:        { label: 'Análise de documentos',     grupo: 'Análise',   chave: 'analise' },
  analise_geral:  { label: 'Análise geral do caso',    grupo: 'Análise',   chave: 'analise_geral' },
  comando:        { label: 'Comandos IA no editor',    grupo: 'Editor',    chave: 'comando' },
  correcao:       { label: 'Correção automática',      grupo: 'Editor',    chave: 'correcao' },
}

/** Limites por plano (chamadas permitidas por categoria) */
const LIMITES_PLANO: Record<string, Record<string, number>> = {
  trial: {
    gerar_peca:    50,
    refinar_peca:  50,
    validar_peca:  30,
    analise:       20,
    analise_geral: 100,
    comando:       200,
    correcao:      200,
  },
  basico: {
    gerar_peca:    200,
    refinar_peca:  200,
    validar_peca:  100,
    analise:       100,
    analise_geral: 500,
    comando:       1000,
    correcao:      1000,
  },
  profissional: {
    gerar_peca:    1000,
    refinar_peca:  1000,
    validar_peca:  500,
    analise:       500,
    analise_geral: 2000,
    comando:       5000,
    correcao:      5000,
  },
}

function categorizar(endpoint: string): { label: string; grupo: string; chave: string } {
  if (CATEGORIAS[endpoint]) return CATEGORIAS[endpoint]
  if (endpoint.startsWith('comando_')) return CATEGORIAS.comando
  if (endpoint.startsWith('correcao_')) return CATEGORIAS.correcao
  return { label: endpoint, grupo: 'Outros', chave: endpoint }
}

export async function GET() {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })

  const { data: usuario } = await supabase
    .from('users')
    .select('id, tenant_id, tenants(plano)')
    .eq('auth_user_id', user.id)
    .single()

  if (!usuario) return NextResponse.json({ error: 'Usuário não encontrado' }, { status: 404 })

  const plano = (usuario.tenants as { plano?: string } | null)?.plano ?? 'trial'
  const limites = LIMITES_PLANO[plano] ?? LIMITES_PLANO.trial

  // Fetch all usage logs for this tenant
  const { data: logs, error } = await supabase
    .from('api_usage_log')
    .select('endpoint, tokens_input, tokens_output, custo_estimado, created_at')
    .eq('tenant_id', usuario.tenant_id)
    .order('created_at', { ascending: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Aggregate by category
  const porCategoria: Record<string, {
    label: string
    grupo: string
    chave: string
    chamadas: number
    tokensInput: number
    tokensOutput: number
    custoEstimado: number
    limite: number
  }> = {}

  let totalInput = 0
  let totalOutput = 0
  let totalCusto = 0
  let totalChamadas = 0
  let pecasGeradas = 0

  // Usage over last 30 days (for chart)
  const agora = new Date()
  const dias30 = new Date(agora)
  dias30.setDate(dias30.getDate() - 30)
  const porDia: Record<string, { tokens: number; chamadas: number }> = {}

  for (const log of (logs ?? [])) {
    const cat = categorizar(log.endpoint)
    const key = cat.label

    if (!porCategoria[key]) {
      porCategoria[key] = {
        label: cat.label,
        grupo: cat.grupo,
        chave: cat.chave,
        chamadas: 0,
        tokensInput: 0,
        tokensOutput: 0,
        custoEstimado: 0,
        limite: limites[cat.chave] ?? 100,
      }
    }

    const inp = log.tokens_input ?? 0
    const out = log.tokens_output ?? 0
    const custo = Number(log.custo_estimado ?? 0)

    porCategoria[key].chamadas++
    porCategoria[key].tokensInput += inp
    porCategoria[key].tokensOutput += out
    porCategoria[key].custoEstimado += custo

    totalInput += inp
    totalOutput += out
    totalCusto += custo
    totalChamadas++
    if (log.endpoint === 'gerar_peca') pecasGeradas++

    // Daily aggregation for last 30 days
    const dt = new Date(log.created_at)
    if (dt >= dias30) {
      const dia = log.created_at.substring(0, 10) // YYYY-MM-DD
      if (!porDia[dia]) porDia[dia] = { tokens: 0, chamadas: 0 }
      porDia[dia].tokens += inp + out
      porDia[dia].chamadas++
    }
  }

  // Build sorted daily array
  const diasArray = []
  for (let d = new Date(dias30); d <= agora; d.setDate(d.getDate() + 1)) {
    const key = d.toISOString().substring(0, 10)
    diasArray.push({
      dia: key,
      tokens: porDia[key]?.tokens ?? 0,
      chamadas: porDia[key]?.chamadas ?? 0,
    })
  }

  // Convert category costs to BRL and group by grupo
  const grupos: Record<string, typeof porCategoria[string][]> = {}
  for (const cat of Object.values(porCategoria)) {
    cat.custoEstimado = Math.round(cat.custoEstimado * USD_BRL * 100) / 100
    if (!grupos[cat.grupo]) grupos[cat.grupo] = []
    grupos[cat.grupo].push(cat)
  }

  const totalCustoBrl = Math.round(totalCusto * USD_BRL * 100) / 100

  return NextResponse.json({
    resumo: {
      totalChamadas,
      totalInput,
      totalOutput,
      totalTokens: totalInput + totalOutput,
      totalCusto: totalCustoBrl,
      pecasGeradas,
    },
    plano,
    grupos,
    historicoDiario: diasArray,
  })
}
