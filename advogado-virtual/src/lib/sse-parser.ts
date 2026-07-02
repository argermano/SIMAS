// Parser de Server-Sent Events (SSE) resiliente a fragmentação de chunks.
//
// Motivação: o cliente antigo fazia `chunk.split('\n')` a cada read do reader,
// sem guardar a linha parcial entre reads. Em rede móvel, um evento
// `data: {...}` cortado na fronteira de dois chunks gerava JSON.parse inválido
// e abortava a geração inteira de forma intermitente. Este parser mantém um
// buffer da linha incompleta e só entrega eventos de linhas COMPLETAS.
//
// Contrato dos eventos vindos do servidor (streamCompletion em
// src/lib/anthropic/client.ts): { type:'text', text } · { type:'done',
// inputTokens, outputTokens, stopReason } · { type:'error', error }.

export type SSEEvent =
  | { type: 'text'; text: string }
  | { type: 'done'; stopReason?: string | null; inputTokens?: number; outputTokens?: number }
  | { type: 'error'; error: string }
  | { type: string; [k: string]: unknown }

/**
 * Interpreta uma única linha do stream. Retorna o evento ou null se a linha
 * não for um `data:` válido (comentário SSE, linha em branco ou JSON malformado
 * — todos ignoráveis, nunca lançam).
 */
function parseLine(line: string): SSEEvent | null {
  const limpa = line.trimEnd() // tolera terminação \r\n
  if (!limpa.startsWith('data:')) return null
  const payload = limpa.slice(limpa.startsWith('data: ') ? 6 : 5)
  if (!payload) return null
  try {
    return JSON.parse(payload) as SSEEvent
  } catch {
    return null // linha malformada/parcial — ignorada, não aborta o stream
  }
}

/**
 * Parser com estado (buffer de linha parcial). Uso:
 *   const p = createSSEParser()
 *   for cada chunk:  p.feed(chunk).forEach(dispatch)
 *   ao final:        p.flush().forEach(dispatch)
 * O chamador despacha os eventos (e decide lançar em `type:'error'`), mantendo
 * o parse isolado de efeitos colaterais.
 */
export function createSSEParser() {
  let buffer = ''
  return {
    feed(chunk: string): SSEEvent[] {
      buffer += chunk
      const eventos: SSEEvent[] = []
      let idx: number
      while ((idx = buffer.indexOf('\n')) !== -1) {
        const linha = buffer.slice(0, idx)
        buffer = buffer.slice(idx + 1)
        const ev = parseLine(linha)
        if (ev) eventos.push(ev)
      }
      return eventos
    },
    /** Interpreta o que sobrou no buffer quando o stream termina sem \n final. */
    flush(): SSEEvent[] {
      const resto = buffer
      buffer = ''
      const ev = parseLine(resto)
      return ev ? [ev] : []
    },
  }
}
