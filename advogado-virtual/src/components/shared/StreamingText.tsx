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
      let stopReason: string | null | undefined

      const despachar = (data: ReturnType<typeof parser.feed>[number]) => {
        if (data.type === 'text') {
          fullText += (data as { text: string }).text
          setText(fullText)
        } else if (data.type === 'done') {
          stopReason = (data as { stopReason?: string | null }).stopReason
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
      return { fullText, headers: res.headers, stopReason }
    } catch (err) {
      if ((err as Error).name === 'AbortError') return null
      const msg = (err as Error).message
      setError(msg)
      setLoading(false)
      return null
    }
  }

  function stop() {
    abortRef.current?.abort()
    setLoading(false)
  }

  return { text, loading, error, startStream, stop }
}
