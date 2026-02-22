import Anthropic from '@anthropic-ai/sdk'

let _client: Anthropic | null = null

export function getAnthropicClient(): Anthropic {
  if (!_client) {
    const apiKey = process.env.ANTHROPIC_API_KEY
    if (!apiKey || apiKey.includes('PREENCHA')) {
      throw new Error('ANTHROPIC_API_KEY não configurada no .env.local')
    }
    _client = new Anthropic({ apiKey })
  }
  return _client
}

export const DEFAULT_MODEL = process.env.ANTHROPIC_MODEL ?? 'claude-sonnet-4-5-20250929'
export const DEFAULT_MAX_TOKENS = Number(process.env.ANTHROPIC_MAX_TOKENS ?? 8192)

/**
 * Faz uma chamada com streaming e retorna um ReadableStream para SSE
 */
export async function streamCompletion(params: {
  system: string
  prompt: string
  model?: string
  maxTokens?: number
}): Promise<{ stream: ReadableStream; getUsage: () => Promise<{ input: number; output: number }> }> {
  const client = getAnthropicClient()

  let inputTokens = 0
  let outputTokens = 0

  const anthropicStream = client.messages.stream({
    model: params.model ?? DEFAULT_MODEL,
    max_tokens: params.maxTokens ?? DEFAULT_MAX_TOKENS,
    system: params.system,
    messages: [{ role: 'user', content: params.prompt }],
  })

  const readable = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder()

      anthropicStream.on('text', (text) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'text', text })}\n\n`))
      })

      anthropicStream.on('message', (message) => {
        inputTokens = message.usage.input_tokens
        outputTokens = message.usage.output_tokens
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'done', inputTokens, outputTokens })}\n\n`))
        controller.close()
      })

      anthropicStream.on('error', (error) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'error', error: error.message })}\n\n`))
        controller.close()
      })
    },
  })

  return {
    stream: readable,
    getUsage: async () => {
      await anthropicStream.finalMessage()
      return { input: inputTokens, output: outputTokens }
    },
  }
}

/**
 * Faz uma chamada sem streaming (para JSON responses)
 */
export async function completionJSON<T = unknown>(params: {
  system: string
  prompt: string
  model?: string
  maxTokens?: number
}): Promise<{ result: T; usage: { input: number; output: number } }> {
  const client = getAnthropicClient()

  const message = await client.messages.create({
    model: params.model ?? DEFAULT_MODEL,
    max_tokens: params.maxTokens ?? DEFAULT_MAX_TOKENS,
    system: params.system,
    messages: [{ role: 'user', content: params.prompt }],
  })

  const text = message.content
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('')

  // Extrair JSON do texto (pode vir envolto em ```json ... ```)
  const jsonMatch = text.match(/```json\s*([\s\S]*?)```/) ?? text.match(/\{[\s\S]*\}/)
  const jsonStr = jsonMatch ? (jsonMatch[1] ?? jsonMatch[0]) : text

  const result = JSON.parse(jsonStr) as T

  return {
    result,
    usage: {
      input: message.usage.input_tokens,
      output: message.usage.output_tokens,
    },
  }
}
