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

export const DEFAULT_MODEL = process.env.ANTHROPIC_MODEL ?? 'claude-sonnet-4-6'
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
        const msg = error.message?.includes('credit balance')
          ? 'Créditos da IA esgotados. Acesse o painel da Anthropic para adicionar créditos.'
          : error.message ?? 'Erro desconhecido na geração'
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'error', error: msg })}\n\n`))
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
 * Extrai texto de uma imagem usando Claude Vision (OCR)
 */
export async function extractTextFromImage(params: {
  imageBase64: string
  mediaType: 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp'
}): Promise<string> {
  const client = getAnthropicClient()

  const message = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 4096,
    messages: [{
      role: 'user',
      content: [
        {
          type: 'image',
          source: {
            type: 'base64',
            media_type: params.mediaType,
            data: params.imageBase64,
          },
        },
        {
          type: 'text',
          text: 'Extraia TODO o texto visível nesta imagem de documento. Transcreva fielmente nomes, números (CPF, RG, CNPJ), datas, endereços e qualquer outro texto presente. Retorne apenas o texto extraído, sem explicações.',
        },
      ],
    }],
  })

  return message.content
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('')
}

/**
 * Extrai texto de um PDF usando Claude (suporte nativo a documentos)
 */
export async function extractTextFromPdf(params: {
  pdfBase64: string
}): Promise<string> {
  const client = getAnthropicClient()

  const message = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 4096,
    messages: [{
      role: 'user',
      content: [
        {
          type: 'document',
          source: {
            type: 'base64',
            media_type: 'application/pdf',
            data: params.pdfBase64,
          },
        },
        {
          type: 'text',
          text: 'Extraia TODO o texto visível neste documento PDF. Transcreva fielmente nomes completos, números (CPF, RG, CNPJ, OAB), datas, endereços completos, estado civil, nacionalidade, profissão, e qualquer outro dado pessoal ou jurídico. Retorne apenas o texto extraído, sem explicações.',
        },
      ],
    }],
  })

  return message.content
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('')
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
