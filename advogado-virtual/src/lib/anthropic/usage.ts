import { createClient } from '@/lib/supabase/server'

// Preço estimado por 1K tokens (USD), por modelo. Fonte: docs.claude.com
// (jul/2026). Antes o custo era fixo em Sonnet — o Opus 4.8 ($5/$25 MTok)
// ficava ~40% subestimado e o Haiku de OCR superestimado.
const PRECOS_1K: Record<string, { input: number; output: number }> = {
  'claude-opus-4-8':   { input: 0.005, output: 0.025 },
  'claude-opus-4-7':   { input: 0.005, output: 0.025 },
  'claude-sonnet-5':   { input: 0.003, output: 0.015 },
  'claude-sonnet-4-6': { input: 0.003, output: 0.015 },
  'claude-haiku-4-5':  { input: 0.001, output: 0.005 },
}
const PRECO_PADRAO = { input: 0.003, output: 0.015 } // Sonnet — fallback

/** Preço por 1K tokens do modelo (tolera sufixo de data, ex.: -20251001). */
function precoDe(modelo: string): { input: number; output: number } {
  for (const [id, preco] of Object.entries(PRECOS_1K)) {
    if (modelo.startsWith(id)) return preco
  }
  return PRECO_PADRAO
}

export async function logUsage(params: {
  tenantId: string
  userId: string
  endpoint: string
  modelo: string
  tokensInput: number
  tokensOutput: number
  latenciaMs: number
}) {
  const preco = precoDe(params.modelo)
  const custoEstimado =
    (params.tokensInput / 1000) * preco.input +
    (params.tokensOutput / 1000) * preco.output

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

// Preço do Whisper (Groq whisper-large-v3): US$ por SEGUNDO de áudio.
// A Groq cobra por hora de áudio (~US$ 0,111/h em jul/2026) — dividimos por
// 3600. A transcrição não gera tokens Anthropic; o custo é função da duração.
// Ajustável via GROQ_WHISPER_PRECO_SEG caso o preço mude.
const PRECO_WHISPER_SEG = Number(process.env.GROQ_WHISPER_PRECO_SEG ?? (0.111 / 3600))

/**
 * Registra o custo de uma transcrição de áudio no mesmo `api_usage_log` das
 * chamadas de IA — antes a transcrição (Groq/Whisper) não entrava no painel de
 * custo, deixando um buraco na visibilidade de uso. Nunca lança (fire-safe):
 * uma falha de log não pode derrubar a transcrição já concluída.
 */
export async function logTranscricao(params: {
  tenantId: string
  userId: string
  endpoint: string
  segundosAudio: number
  latenciaMs: number
  modelo?: string
}): Promise<void> {
  try {
    const custoEstimado = Math.max(0, params.segundosAudio || 0) * PRECO_WHISPER_SEG
    const supabase = await createClient()
    const { error } = await supabase.from('api_usage_log').insert({
      tenant_id:      params.tenantId,
      user_id:        params.userId,
      endpoint:       params.endpoint,
      modelo:         params.modelo ?? 'groq-whisper-large-v3',
      tokens_input:   0,
      tokens_output:  0,
      custo_estimado: custoEstimado,
      latencia_ms:    params.latenciaMs,
    })
    if (error) {
      console.error(`[logTranscricao] falha ao registrar (${params.endpoint}, tenant ${params.tenantId}):`, error.message)
    }
  } catch (err) {
    console.error(`[logTranscricao] erro inesperado (${params.endpoint}):`, err instanceof Error ? err.message : err)
  }
}
