'use client'

import { useState, useEffect, useRef } from 'react'
import { createSSEParser } from '@/lib/sse-parser'

interface StreamingTextProps {
  url: string
  body: Record<string, unknown>
  onComplete?: (fullText: string) => void
  onError?: (error: string) => void
  className?: string
}

export function StreamingText({ url, body, onComplete, onError, className }: StreamingTextProps) {
  const [text, setText] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const abortRef = useRef<AbortController>(undefined)

  useEffect(() => {
    const controller = new AbortController()
    abortRef.current = controller

    async function stream() {
      try {
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
          signal: controller.signal,
        })

        if (!res.ok) {
          const data = await res.json().catch(() => ({ error: 'Erro desconhecido' }))
          throw new Error(data.error ?? `HTTP ${res.status}`)
        }

        const reader = res.body?.getReader()
        if (!reader) throw new Error('Sem stream disponível')

        const decoder = new TextDecoder()
        const parser = createSSEParser()
        let fullText = ''

        const despachar = (data: ReturnType<typeof parser.feed>[number]) => {
          if (data.type === 'text') {
            fullText += (data as { text: string }).text
            setText(fullText)
          } else if (data.type === 'done') {
            onComplete?.(fullText)
          } else if (data.type === 'error') {
            throw new Error((data as { error?: string }).error ?? 'Erro na geração')
          }
        }

        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          const chunk = decoder.decode(value, { stream: true })
          for (const ev of parser.feed(chunk)) despachar(ev)
        }
        for (const ev of parser.flush()) despachar(ev)

        setLoading(false)
      } catch (err) {
        if ((err as Error).name === 'AbortError') return
        const msg = (err as Error).message
        setError(msg)
        setLoading(false)
        onError?.(msg)
      }
    }

    stream()

    return () => controller.abort()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url])

  if (error) {
    return (
      <div className="rounded-lg border border-destructive/20 bg-destructive/5 p-4 text-sm text-destructive">
        Erro: {error}
      </div>
    )
  }

  return (
    <div className={className}>
      {text ? (
        <div className="whitespace-pre-wrap text-sm leading-relaxed text-foreground">{text}</div>
      ) : loading ? (
        <div className="flex items-center gap-3 py-4">
          <div className="h-5 w-5 animate-spin rounded-full border-2 border-primary/20 border-t-primary" />
          <span className="text-sm text-muted-foreground">Gerando com IA...</span>
        </div>
      ) : null}
      {loading && text && (
        <span className="inline-block h-4 w-1 animate-pulse bg-primary/70 ml-0.5" />
      )}
    </div>
  )
}

/** Resultado de uma geração via streaming. */
export interface ResultadoStreaming {
  fullText: string
  headers: Headers
  /** Motivo de término reportado pelo modelo ('end_turn', 'max_tokens', ...). */
  stopReason?: string | null
  /**
   * True SOMENTE quando o evento SSE 'done' chegou — ou seja, o stream terminou
   * de forma limpa. False quando a conexão caiu no meio (EOF precoce sem 'done'
   * ou erro de rede após já haver texto parcial): o chamador deve tratar como
   * incompleto e recuperar o texto completo salvo no servidor (X-Peca-Id).
   */
  completo: boolean
}

/**
 * Hook para streaming de texto
 */
export function useStreaming() {
  const [text, setText] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const abortRef = useRef<AbortController>(undefined)

  async function startStream(url: string, body: Record<string, unknown>): Promise<ResultadoStreaming | null> {
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller

    setLoading(true)
    setError(null)
    setText('')

    // Guardados fora do try para que o catch de queda de rede consiga devolver
    // o parcial (com os headers, p/ o X-Peca-Id) em vez de simplesmente null.
    let res: Response | undefined
    let fullText = ''
    let stopReason: string | null | undefined
    let recebeuDone = false
    let erroDoServidor = false

    try {
      res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      })

      if (!res.ok) {
        const data = await res.json().catch(() => ({ error: 'Erro desconhecido' }))
        erroDoServidor = true
        throw new Error(data.error ?? `HTTP ${res.status}`)
      }

      const reader = res.body?.getReader()
      if (!reader) throw new Error('Sem stream disponível')

      const decoder = new TextDecoder()
      const parser = createSSEParser()

      const despachar = (data: ReturnType<typeof parser.feed>[number]) => {
        if (data.type === 'text') {
          fullText += (data as { text: string }).text
          setText(fullText)
        } else if (data.type === 'done') {
          stopReason = (data as { stopReason?: string | null }).stopReason
          recebeuDone = true // só aqui o stream é considerado completo
        } else if (data.type === 'error') {
          erroDoServidor = true // falha real de geração, não queda de rede
          throw new Error((data as { error?: string }).error ?? 'Erro na geração')
        }
      }

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        const chunk = decoder.decode(value, { stream: true })
        for (const ev of parser.feed(chunk)) despachar(ev)
      }
      for (const ev of parser.flush()) despachar(ev)

      setLoading(false)
      // completo só é true se o evento 'done' chegou; EOF precoce → false.
      return { fullText, headers: res.headers, stopReason, completo: recebeuDone }
    } catch (err) {
      if ((err as Error).name === 'AbortError') return null // stop() do usuário
      const msg = (err as Error).message
      setError(msg)
      setLoading(false)
      // Queda de rede DEPOIS de já ter headers + texto parcial (e não foi erro
      // explícito do servidor): devolve o parcial marcado como incompleto para
      // o chamador recuperar o texto completo salvo no servidor. Caso contrário
      // (erro do servidor/HTTP, sem parcial), mantém o null de antes.
      if (res && fullText && !erroDoServidor) {
        return { fullText, headers: res.headers, stopReason: undefined, completo: false }
      }
      return null
    }
  }

  function stop() {
    abortRef.current?.abort()
    setLoading(false)
  }

  return { text, loading, error, startStream, stop }
}
