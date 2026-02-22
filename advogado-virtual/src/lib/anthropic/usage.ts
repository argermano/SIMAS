import { createClient } from '@/lib/supabase/server'

// Custo estimado por 1K tokens (Claude Sonnet)
const CUSTO_INPUT_1K = 0.003
const CUSTO_OUTPUT_1K = 0.015

export async function logUsage(params: {
  tenantId: string
  userId: string
  endpoint: string
  modelo: string
  tokensInput: number
  tokensOutput: number
  latenciaMs: number
}) {
  const custoEstimado =
    (params.tokensInput / 1000) * CUSTO_INPUT_1K +
    (params.tokensOutput / 1000) * CUSTO_OUTPUT_1K

  const supabase = await createClient()

  await supabase.from('api_usage_log').insert({
    tenant_id: params.tenantId,
    user_id: params.userId,
    endpoint: params.endpoint,
    modelo: params.modelo,
    tokens_input: params.tokensInput,
    tokens_output: params.tokensOutput,
    custo_estimado: custoEstimado,
    latencia_ms: params.latenciaMs,
  })
}
