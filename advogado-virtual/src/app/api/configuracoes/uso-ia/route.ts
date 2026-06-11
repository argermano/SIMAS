import { NextResponse } from 'next/server'
import { getAuthContext } from '@/lib/auth'
import { jsonError } from '@/lib/api'
import { LIMITES_PLANO, categorizar } from '@/lib/anthropic/quota'

// Taxa de conversão USD → BRL (atualizar periodicamente)
const USD_BRL = 5.70

export async function GET() {
  const auth = await getAuthContext()
  if (!auth.ok) return auth.response
  const { supabase, usuario } = auth

  const { data: tenant } = await supabase
    .from('tenants')
    .select('plano')
    .eq('id', usuario.tenant_id)
    .single()

  const plano = (tenant as { plano?: string } | null)?.plano ?? 'trial'
  const limites = LIMITES_PLANO[plano] ?? LIMITES_PLANO.trial

  // Fetch all usage logs for this tenant
  const { data: logs, error } = await supabase
    .from('api_usage_log')
    .select('endpoint, tokens_input, tokens_output, custo_estimado, created_at')
    .eq('tenant_id', usuario.tenant_id)
    .order('created_at', { ascending: false })

  if (error) return jsonError(error.message, 500)

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
