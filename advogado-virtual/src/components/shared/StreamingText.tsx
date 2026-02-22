'use client'

import { useState, useEffect, useRef } from 'react'

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
        let fullText = ''

        while (true) {
          const { done, value } = await reader.read()
          if (done) break

          const chunk = decoder.decode(value, { stream: true })
          const lines = chunk.split('\n')

          for (const line of lines) {
            if (!line.startsWith('data: ')) continue
            try {
              const data = JSON.parse(line.slice(6))
              if (data.type === 'text') {
                fullText += data.text
                setText(fullText)
              } else if (data.type === 'done') {
                onComplete?.(fullText)
              } else if (data.type === 'error') {
                throw new Error(data.error)
              }
            } catch {
              // Ignorar linhas malformadas
            }
          }
        }

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
      <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
        Erro: {error}
      </div>
    )
  }

  return (
    <div className={className}>
      {text ? (
        <div className="whitespace-pre-wrap text-sm leading-relaxed text-gray-800">{text}</div>
      ) : loading ? (
        <div className="flex items-center gap-3 py-4">
          <div className="h-5 w-5 animate-spin rounded-full border-2 border-primary-200 border-t-primary-800" />
          <span className="text-sm text-gray-500">Gerando com IA...</span>
        </div>
      ) : null}
      {loading && text && (
        <span className="inline-block h-4 w-1 animate-pulse bg-primary-600 ml-0.5" />
      )}
    </div>
  )
}

/**
 * Hook para streaming de texto
 */
export function useStreaming() {
  const [text, setText] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const abortRef = useRef<AbortController>(undefined)

  async function startStream(url: string, body: Record<string, unknown>): Promise<{ fullText: string; headers: Headers } | null> {
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
      let fullText = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        const chunk = decoder.decode(value, { stream: true })
        const lines = chunk.split('\n')

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          try {
            const data = JSON.parse(line.slice(6))
            if (data.type === 'text') {
              fullText += data.text
              setText(fullText)
            } else if (data.type === 'error') {
              throw new Error(data.error ?? 'Erro na geração')
            }
          } catch (parseErr) {
            if (parseErr instanceof Error && parseErr.message !== 'Unexpected') {
              throw parseErr
            }
            // Ignorar linhas JSON malformadas
          }
        }
      }

      setLoading(false)
      return { fullText, headers: res.headers }
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
