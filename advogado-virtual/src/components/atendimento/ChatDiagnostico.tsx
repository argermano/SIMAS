'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { MessageCircle, Send, Loader2, User, Brain, X } from 'lucide-react'

interface Mensagem {
  role: 'user' | 'assistant'
  content: string
}

interface ChatDiagnosticoProps {
  diagnostico: Record<string, unknown>
  transcricao: string
  pedidoEspecifico?: string
}

export function ChatDiagnostico({
  diagnostico,
  transcricao,
  pedidoEspecifico,
}: ChatDiagnosticoProps) {
  const [aberto, setAberto] = useState(false)
  const [mensagens, setMensagens] = useState<Mensagem[]>([])
  const [input, setInput] = useState('')
  const [respondendo, setRespondendo] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  // Scroll automático para última mensagem
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [mensagens, respondendo])

  // Focus no input quando abre o chat
  useEffect(() => {
    if (aberto && inputRef.current) {
      inputRef.current.focus()
    }
  }, [aberto])

  const enviar = useCallback(async () => {
    const texto = input.trim()
    if (!texto || respondendo) return

    const novaMensagem: Mensagem = { role: 'user', content: texto }
    const historico = [...mensagens, novaMensagem]
    setMensagens(historico)
    setInput('')
    setRespondendo(true)

    // Adiciona mensagem vazia do assistente para streaming
    setMensagens(prev => [...prev, { role: 'assistant', content: '' }])

    try {
      const res = await fetch('/api/ia/chat-diagnostico', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mensagem: texto,
          historico: mensagens, // histórico sem a nova mensagem do user
          diagnostico,
          transcricao,
          pedidoEspecifico,
        }),
      })

      if (!res.ok) {
        const data = await res.json().catch(() => ({ error: 'Erro desconhecido' }))
        setMensagens(prev => {
          const copy = [...prev]
          copy[copy.length - 1] = { role: 'assistant', content: `Erro: ${data.error ?? 'Falha ao processar'}` }
          return copy
        })
        setRespondendo(false)
        return
      }

      const reader = res.body?.getReader()
      if (!reader) {
        setRespondendo(false)
        return
      }

      const decoder = new TextDecoder()
      let buffer = ''
      let fullText = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          const payload = line.slice(6)
          if (payload === '[DONE]') continue
          try {
            const parsed = JSON.parse(payload)
            if (parsed.type === 'text' && parsed.text) {
              fullText += parsed.text
              setMensagens(prev => {
                const copy = [...prev]
                copy[copy.length - 1] = { role: 'assistant', content: fullText }
                return copy
              })
            }
          } catch {
            // Ignora linhas inválidas
          }
        }
      }
    } catch {
      setMensagens(prev => {
        const copy = [...prev]
        copy[copy.length - 1] = { role: 'assistant', content: 'Erro de rede. Tente novamente.' }
        return copy
      })
    } finally {
      setRespondendo(false)
    }
  }, [input, respondendo, mensagens, diagnostico, transcricao, pedidoEspecifico])

  if (!aberto) {
    return (
      <button
        onClick={() => setAberto(true)}
        className="flex items-center gap-2 rounded-xl border-2 border-dashed border-primary/30 bg-primary/5 px-4 py-3 text-sm font-medium text-primary hover:border-primary/50 hover:bg-primary/10 transition-colors w-full"
      >
        <MessageCircle className="h-4 w-4" />
        Tirar dúvidas sobre o diagnóstico com a IA
      </button>
    )
  }

  return (
    <div className="rounded-xl border-2 border-primary/20 bg-card overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between border-b bg-primary/5 px-4 py-3">
        <div className="flex items-center gap-2">
          <MessageCircle className="h-4 w-4 text-primary" />
          <span className="text-sm font-semibold text-foreground">Chat sobre o diagnóstico</span>
        </div>
        <button
          onClick={() => setAberto(false)}
          className="rounded p-1 text-muted-foreground hover:text-foreground transition-colors"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Mensagens */}
      <div
        ref={scrollRef}
        className="max-h-80 overflow-y-auto p-4 space-y-4"
      >
        {mensagens.length === 0 && (
          <div className="text-center py-6">
            <Brain className="h-8 w-8 text-muted-foreground/40 mx-auto mb-2" />
            <p className="text-sm text-muted-foreground">
              Pergunte sobre o diagnóstico, estratégia processual, prazos ou qualquer dúvida sobre o caso.
            </p>
            <div className="flex flex-wrap justify-center gap-2 mt-3">
              {[
                'Qual a melhor estratégia processual?',
                'Quais são os prazos aplicáveis?',
                'É melhor resolver administrativamente?',
              ].map((sugestao) => (
                <button
                  key={sugestao}
                  onClick={() => { setInput(sugestao); inputRef.current?.focus() }}
                  className="rounded-lg border bg-muted/50 px-3 py-1.5 text-xs text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
                >
                  {sugestao}
                </button>
              ))}
            </div>
          </div>
        )}

        {mensagens.map((msg, i) => (
          <div key={i} className={`flex gap-3 ${msg.role === 'user' ? 'justify-end' : ''}`}>
            {msg.role === 'assistant' && (
              <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/10">
                <Brain className="h-3.5 w-3.5 text-primary" />
              </div>
            )}
            <div className={`max-w-[85%] rounded-xl px-4 py-2.5 text-sm leading-relaxed ${
              msg.role === 'user'
                ? 'bg-primary text-primary-foreground'
                : 'bg-muted/80 text-foreground'
            }`}>
              {msg.content || (
                <span className="flex items-center gap-2 text-muted-foreground">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  Pensando...
                </span>
              )}
              {msg.role === 'assistant' && respondendo && i === mensagens.length - 1 && msg.content && (
                <span className="inline-block h-3.5 w-0.5 animate-pulse bg-primary/70 ml-0.5 align-middle" />
              )}
            </div>
            {msg.role === 'user' && (
              <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-muted">
                <User className="h-3.5 w-3.5 text-muted-foreground" />
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Input */}
      <div className="border-t p-3">
        <div className="flex gap-2">
          <textarea
            ref={inputRef as React.RefObject<HTMLTextAreaElement>}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                enviar()
              }
            }}
            placeholder="Pergunte sobre o diagnóstico..."
            rows={1}
            className="flex-1 resize-none rounded-lg border border-border bg-background px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-ring/20"
            disabled={respondendo}
          />
          <Button
            size="sm"
            onClick={enviar}
            disabled={!input.trim() || respondendo}
            className="shrink-0 h-9 w-9 p-0"
          >
            {respondendo ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Send className="h-4 w-4" />
            )}
          </Button>
        </div>
      </div>
    </div>
  )
}
