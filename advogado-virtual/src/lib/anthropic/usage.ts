import { createClient } from '@/lib/supabase/server'

/**
 * Preço de um modelo. `intro` é um preço promocional VIGENTE ATÉ a data `ate`
 * (inclusive) — depois dela o preço cheio volta sozinho, sem deploy.
 */
export interface PrecoModelo {
  /** USD por milhão de tokens de entrada. */
  input: number
  /** USD por milhão de tokens de saída. */
  output: number
  intro?: { input: number; output: number; ate: string }
}

/**
 * Preço de LISTA por MILHÃO de tokens (USD). Fonte: documentação oficial da
 * Anthropic (ago/2026). Substitui a antiga tabela PRECOS_1K, que não conhecia
 * opus-5/sonnet-5/fable-5 nem as parcelas de cache (§10 do
 * docs/PLANO-MOTOR-V3-OPUS.md — o medidor é pré-requisito da cobrança).
 *
 * O casamento é por PREFIXO do id do modelo (tolera sufixo de data, ex.:
 * `claude-haiku-4-5-20251001`), sempre pela chave MAIS LONGA que casa.
 */
export const PRECOS_MTOK: Record<string, PrecoModelo> = {
  'claude-opus-5':     { input: 5,  output: 25 },
  'claude-fable-5':    { input: 10, output: 50 },
  // Sonnet 5 tem preço de introdução (2/10) até 31/08/2026 INCLUSIVE.
  'claude-sonnet-5':   { input: 3,  output: 15, intro: { input: 2, output: 10, ate: '2026-08-31' } },
  'claude-opus-4-8':   { input: 5,  output: 25 },
  'claude-opus-4-7':   { input: 5,  output: 25 },
  'claude-sonnet-4-6': { input: 3,  output: 15 },
  'claude-haiku-4-5':  { input: 1,  output: 5 },
}

/** Fallback (Sonnet) para modelo desconhecido — nunca zera o custo do painel. */
export const PRECO_PADRAO_MTOK: PrecoModelo = { input: 3, output: 15 }

/**
 * Multiplicadores do cache de prompt sobre o preço de INPUT do modelo:
 *  - LEITURA (`cache_read_input_tokens`): 0,1× — é a economia das rodadas 2+.
 *  - ESCRITA (`cache_creation_input_tokens`): 2× no TTL de 1 HORA (o que o
 *    client.ts usa; a escrita de 5 min custaria 1,25×).
 */
export const MULT_CACHE_LEITURA = 0.1
export const MULT_CACHE_ESCRITA_1H = 2

/**
 * Preço por milhão de tokens do modelo na data indicada.
 * A vigência do preço de introdução é comparada em UTC no formato AAAA-MM-DD
 * (comparação lexicográfica = cronológica), incluindo o próprio dia `ate`.
 */
export function precoDe(modelo: string, quando: Date = new Date()): { input: number; output: number } {
  const id = modelo ?? ''
  let achado: PrecoModelo | null = null
  let tamanho = -1
  for (const [prefixo, preco] of Object.entries(PRECOS_MTOK)) {
    if (id.startsWith(prefixo) && prefixo.length > tamanho) {
      achado = preco
      tamanho = prefixo.length
    }
  }
  const preco = achado ?? PRECO_PADRAO_MTOK
  if (preco.intro && quando.toISOString().slice(0, 10) <= preco.intro.ate) {
    return { input: preco.intro.input, output: preco.intro.output }
  }
  return { input: preco.input, output: preco.output }
}

/** Tokens de uma chamada, já separados pelas parcelas que têm preço distinto. */
export interface TokensChamada {
  modelo: string
  tokensInput: number
  tokensOutput: number
  tokensCacheRead?: number
  tokensCacheWrite?: number
  /** Data de referência do preço (default: agora) — usada pelos testes de vigência. */
  quando?: Date
}

/** Custo de LISTA em USD (input + output + leitura e escrita de cache). */
export function custoEstimadoUSD(t: TokensChamada): number {
  const preco = precoDe(t.modelo, t.quando ?? new Date())
  const mi = (n: number | undefined) => Math.max(0, n ?? 0) / 1_000_000
  return (
    mi(t.tokensInput) * preco.input +
    mi(t.tokensOutput) * preco.output +
    mi(t.tokensCacheRead) * preco.input * MULT_CACHE_LEITURA +
    mi(t.tokensCacheWrite) * preco.input * MULT_CACHE_ESCRITA_1H
  )
}

export async function logUsage(params: {
  tenantId: string
  /** null quando a chamada não tem dono humano (rotina de sistema). A coluna
   * user_id é nullable desde a migration 074. */
  userId: string | null
  endpoint: string
  modelo: string
  tokensInput: number
  tokensOutput: number
  latenciaMs: number
  /** Tokens servidos pelo cache de prompt (0,1× do input). */
  tokensCacheRead?: number
  /** Tokens gravados no cache de prompt (2× do input no TTL de 1h). */
  tokensCacheWrite?: number
  /** Sessão de lapidação a que a chamada pertence (Motor v3). */
  sessaoId?: string | null
  /** Turno da sessão a que a chamada pertence (Motor v3). */
  turnoId?: string | null
  /** Driver/origem do custo: 'messages' (default) | 'managed' | 'transcricao'. */
  origem?: string
}) {
  const custoEstimado = custoEstimadoUSD({
    modelo: params.modelo,
    tokensInput: params.tokensInput,
    tokensOutput: params.tokensOutput,
    tokensCacheRead: params.tokensCacheRead,
    tokensCacheWrite: params.tokensCacheWrite,
  })

  const supabase = await createClient()

  const { error } = await supabase.from('api_usage_log').insert({
    tenant_id: params.tenantId,
    user_id: params.userId ?? null,
    endpoint: params.endpoint,
    modelo: params.modelo,
    tokens_input: params.tokensInput,
    tokens_output: params.tokensOutput,
    tokens_cache_read: params.tokensCacheRead ?? 0,
    tokens_cache_write: params.tokensCacheWrite ?? 0,
    custo_estimado: custoEstimado,
    latencia_ms: params.latenciaMs,
    sessao_id: params.sessaoId ?? null,
    turno_id: params.turnoId ?? null,
    origem: params.origem ?? 'messages',
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
  /** Driver/origem do custo. Default 'transcricao' (não é uma chamada Messages). */
  origem?: string
}): Promise<void> {
  try {
    const custoEstimado = Math.max(0, params.segundosAudio || 0) * PRECO_WHISPER_SEG
    const supabase = await createClient()
    const { error } = await supabase.from('api_usage_log').insert({
      tenant_id:          params.tenantId,
      user_id:            params.userId,
      endpoint:           params.endpoint,
      modelo:             params.modelo ?? 'groq-whisper-large-v3',
      tokens_input:       0,
      tokens_output:      0,
      tokens_cache_read:  0,
      tokens_cache_write: 0,
      custo_estimado:     custoEstimado,
      latencia_ms:        params.latenciaMs,
      origem:             params.origem ?? 'transcricao',
    })
    if (error) {
      console.error(`[logTranscricao] falha ao registrar (${params.endpoint}, tenant ${params.tenantId}):`, error.message)
    }
  } catch (err) {
    console.error(`[logTranscricao] erro inesperado (${params.endpoint}):`, err instanceof Error ? err.message : err)
  }
}
