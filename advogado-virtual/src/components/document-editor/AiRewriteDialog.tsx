'use client'

import { useState, useEffect, useRef } from 'react'
import { Dialog } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Loader2, Sparkles, Check, X } from 'lucide-react'

interface AiRewriteDialogProps {
  open: boolean
  onClose: () => void
  topicText: string
  originalContent: string
  contextoDocumento: string
  onAceitar: (novoConteudo: string) => void
}

export function AiRewriteDialog({
  open,
  onClose,
  topicText,
  originalContent,
  contextoDocumento,
  onAceitar,
}: AiRewriteDialogProps) {
  const [reescrito,   setReescrito]   = useState('')
  const [gerando,     setGerando]     = useState(false)
  const abortRef = useRef<AbortController | null>(null)

  useEffect(() => {
    if (!open) { setReescrito(''); return }
    gerarReescrita()
    return () => { abortRef.current?.abort() }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  async function gerarReescrita() {
    setGerando(true)
    setReescrito('')
    abortRef.current = new AbortController()

    try {
      const res = await fetch('/api/ia/editor-documento', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          acao:                 'reescrever',
          conteudo:             originalContent,
          contexto_documento:   contextoDocumento,
        }),
        signal: abortRef.current.signal,
      })

      if (!res.ok || !res.body) return

      const reader  = res.body.getReader()
      const decoder = new TextDecoder()

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        const chunk = decoder.decode(value)
        for (const line of chunk.split('\n')) {
          if (!line.startsWith('data: ')) continue
          try {
            const ev = JSON.parse(line.slice(6))
            if (ev.type === 'text') setReescrito(p => p + ev.text)
          } catch { /* noop */ }
        }
      }
    } catch (e) {
      if ((e as Error).name !== 'AbortError') console.error(e)
    } finally {
      setGerando(false)
    }
  }

  function handleAceitar() {
    onAceitar(reescrito)
    onClose()
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={`Reescrever: ${topicText}`}
      description="Compare o original com a versão reescrita pela IA e escolha qual usar."
      size="lg"
      footer={
        <>
          <Button variant="secondary" size="md" onClick={onClose}>
            <X className="h-4 w-4 mr-1" />
            Rejeitar
          </Button>
          <Button
            size="md"
            onClick={handleAceitar}
            disabled={gerando || !reescrito}
            className="gap-1.5"
          >
            <Check className="h-4 w-4" />
            Aceitar versão da IA
          </Button>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-4">
        {/* Original */}
        <div>
          <p className="mb-1.5 text-xs font-semibold text-muted-foreground uppercase tracking-wide">Original</p>
          <div className="rounded-lg border bg-muted/50 p-3 text-sm text-foreground leading-relaxed min-h-32 max-h-64 overflow-y-auto whitespace-pre-wrap font-mono">
            {originalContent}
          </div>
        </div>

        {/* Reescrito */}
        <div>
          <p className="mb-1.5 flex items-center gap-1 text-xs font-semibold text-primary uppercase tracking-wide">
            <Sparkles className="h-3 w-3" />
            Reescrito pela IA
          </p>
          <div className="rounded-lg border border-primary/20 bg-primary/5 p-3 text-sm text-foreground leading-relaxed min-h-32 max-h-64 overflow-y-auto whitespace-pre-wrap font-mono">
            {gerando ? (
              <span className="flex items-center gap-2 text-primary/60">
                <Loader2 className="h-4 w-4 animate-spin" />
                Gerando...
              </span>
            ) : reescrito || (
              <span className="text-muted-foreground italic">Aguardando...</span>
            )}
          </div>
        </div>
      </div>
    </Dialog>
  )
}
