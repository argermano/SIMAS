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

  const { error } = await supabase.from('api_usage_log').insert({
    tenant_id: params.tenantId,
    user_id: params.userId,
    endpoint: params.endpoint,
    modelo: params.modelo,
    tokens_input: params.tokensInput,
    tokens_output: params.tokensOutput,
    custo_estimado: custoEstimado,
    latencia_ms: params.latenciaMs,
  })

  if (error) {
    // Não silenciar: log de uso impreciso compromete o dashboard e o enforcement de cota.
    console.error(`[logUsage] falha ao registrar uso (${params.endpoint}, tenant ${params.tenantId}):`, error.message)
  }
}

/**
 * Versão que nunca lança — para uso pós-stream (getUsage().then(...)),
 * onde uma exceção não tratada quebraria o handler do stream. Loga o erro
 * em vez de engoli-lo silenciosamente.
 */
export async function safeLogUsage(params: Parameters<typeof logUsage>[0]): Promise<void> {
  try {
    await logUsage(params)
  } catch (err) {
    console.error(`[logUsage] erro inesperado (${params.endpoint}):`, err instanceof Error ? err.message : err)
  }
}
