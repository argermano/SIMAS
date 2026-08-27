'use client'

import { useState, useRef } from 'react'
import { Dialog } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Loader2, Sparkles, Check, X, MessagesSquare } from 'lucide-react'
import { formatarPeca } from '@/lib/format/formatar-peca'

interface AiComandoDialogProps {
  open: boolean
  onClose: () => void
  documentoMarkdown: string
  /** Peça em edição: dá ao editor-documento o contexto do caso (F0.2). */
  pecaId?: string
  /**
   * Presente só quando há uma sessão de lapidação ATIVA. Aí a mesma instrução
   * rende muito mais como rodada da sessão (dossiê, histórico e proposta por
   * seção) do que como comando avulso sobre o texto da tela.
   */
  onEnviarParaSessao?: (instrucao: string) => void
  onAceitar: (conteudo: string) => void
}

export function AiComandoDialog({
  open,
  onClose,
  documentoMarkdown,
  pecaId,
  onEnviarParaSessao,
  onAceitar,
}: AiComandoDialogProps) {
  const [instrucao,  setInstrucao]  = useState('')
  const [resultado,  setResultado]  = useState('')
  const [gerando,    setGerando]    = useState(false)
  const abortRef = useRef<AbortController | null>(null)

  function handleClose() {
    abortRef.current?.abort()
    setInstrucao('')
    setResultado('')
    setGerando(false)
    onClose()
  }

  async function executarComando() {
    if (!instrucao.trim()) return
    setGerando(true)
    setResultado('')
    abortRef.current = new AbortController()

    try {
      const res = await fetch('/api/ia/editor-documento', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          acao:               'comando_livre',
          instrucao:          instrucao.trim(),
          documento_completo: documentoMarkdown,
          pecaId,
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
            if (ev.type === 'text') setResultado(p => p + ev.text)
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
    onAceitar(formatarPeca(resultado))
    handleClose()
  }

  function enviarParaSessao() {
    const texto = instrucao.trim()
    if (!texto || !onEnviarParaSessao) return
    onEnviarParaSessao(texto)
    handleClose()
  }

  const temSessao = Boolean(onEnviarParaSessao)

  return (
    <Dialog
      open={open}
      onClose={handleClose}
      title="Comando IA"
      description="Digite uma instrução para a IA modificar, formatar ou complementar o documento."
      size="lg"
      footer={
        <>
          <Button variant="secondary" size="md" onClick={handleClose}>
            <X className="h-4 w-4 mr-1" />
            Cancelar
          </Button>
          {!resultado && !gerando ? (
            <>
              {temSessao && (
                <Button
                  size="md"
                  variant="ghost"
                  onClick={executarComando}
                  disabled={!instrucao.trim()}
                  className="gap-1.5"
                  title="Aplica a instrução só ao texto desta tela, sem o dossiê nem o histórico"
                >
                  <Sparkles className="h-4 w-4" />
                  Executar aqui
                </Button>
              )}
              <Button
                size="md"
                onClick={temSessao ? enviarParaSessao : executarComando}
                disabled={!instrucao.trim()}
                className="gap-1.5"
              >
                {temSessao ? <MessagesSquare className="h-4 w-4" /> : <Sparkles className="h-4 w-4" />}
                {temSessao ? 'Enviar para a sessão' : 'Executar'}
              </Button>
            </>
          ) : (
            <Button
              size="md"
              onClick={handleAceitar}
              disabled={gerando || !resultado}
              className="gap-1.5"
            >
              <Check className="h-4 w-4" />
              Aceitar e aplicar
            </Button>
          )}
        </>
      }
    >
      <div className="space-y-4">
        {temSessao && (
          <p className="flex items-start gap-2 rounded-lg border border-primary/20 bg-primary/5 px-3 py-2 text-xs text-muted-foreground">
            <MessagesSquare className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
            <span>
              Há uma <strong className="font-semibold text-foreground">sessão de lapidação</strong> aberta nesta peça.
              Enviada para a sessão, a instrução entra com o dossiê do caso e o histórico da conversa, e volta como
              proposta por seção — em vez de reescrever o documento inteiro aqui.
            </span>
          </p>
        )}

        {/* Campo de instrução */}
        <div>
          <label className="mb-1.5 block text-xs font-semibold text-muted-foreground uppercase tracking-wide">
            Instrução
          </label>
          <textarea
            value={instrucao}
            onChange={(e) => setInstrucao(e.target.value)}
            placeholder="Ex: Adicione espaço de parágrafo no texto / Remova a numeração dos tópicos / Adicione uma seção sobre danos morais..."
            rows={3}
            className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm resize-none outline-none focus:ring-1 focus:ring-primary/40"
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && !gerando) {
                if (temSessao) enviarParaSessao()
                else executarComando()
              }
            }}
            disabled={gerando}
            autoFocus
          />
          <p className="mt-1 text-xs text-muted-foreground">
            Ctrl+Enter para {temSessao ? 'enviar para a sessão' : 'executar'}
          </p>
        </div>

        {/* Preview do resultado */}
        {(gerando || resultado) && (
          <div>
            <p className="mb-1.5 flex items-center gap-1 text-xs font-semibold text-primary uppercase tracking-wide">
              <Sparkles className="h-3 w-3" />
              Resultado da IA
            </p>
            <div className="rounded-lg border border-primary/20 bg-primary/5 p-3 text-sm text-foreground leading-relaxed min-h-32 max-h-64 overflow-y-auto whitespace-pre-wrap font-mono">
              {gerando && !resultado ? (
                <span className="flex items-center gap-2 text-primary/60">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Gerando...
                </span>
              ) : (
                resultado
              )}
            </div>
          </div>
        )}
      </div>
    </Dialog>
  )
}
