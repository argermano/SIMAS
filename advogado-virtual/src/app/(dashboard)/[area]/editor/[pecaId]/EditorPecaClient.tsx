'use client'

import { useState, useRef, useEffect, type ComponentProps } from 'react'
import { useRouter } from 'next/navigation'
import { DocumentEditor } from '@/components/document-editor/DocumentEditor'
import { RelatorioValidacao } from '@/components/pecas/RelatorioValidacao'
import { useStreaming } from '@/components/shared/StreamingText'
import { formatarPeca } from '@/lib/format/formatar-peca'
import { Button } from '@/components/ui/button'
import { useToast } from '@/components/ui/toast'
import { Send, CheckCircle, Clock, ClipboardCheck, X, Loader2 } from 'lucide-react'

type ValidacaoData = ComponentProps<typeof RelatorioValidacao>['data']

interface EditorPecaClientProps {
  pecaId: string
  atendimentoId: string
  clienteId?: string
  area: string
  tipo: string
  tipoNome: string
  conteudoInicial: string
  versaoInicial: number
  statusInicial: string
  validacaoInicial?: ValidacaoData | null
}

const PRAZO_OPTIONS = [
  { label: '24 horas',  days: 1 },
  { label: '2 dias',    days: 2 },
  { label: '3 dias',    days: 3 },
  { label: '5 dias',    days: 5 },
  { label: '1 semana',  days: 7 },
  { label: '2 semanas', days: 14 },
]

export function EditorPecaClient({
  pecaId,
  atendimentoId,
  clienteId,
  area,
  tipo,
  tipoNome,
  conteudoInicial,
  statusInicial,
  validacaoInicial,
}: EditorPecaClientProps) {
  const router = useRouter()
  const { success, error: toastError } = useToast()
  const [salvando, setSalvando]       = useState(false)
  const [enviando, setEnviando]       = useState(false)
  const [status, setStatus]           = useState(statusInicial)
  const [menuOpen, setMenuOpen]       = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  // Conteúdo atual da peça — pode ser substituído por uma correção automática.
  // editorKey força o remount do DocumentEditor quando o conteúdo é reescrito.
  const [conteudoAtual, setConteudoAtual] = useState(conteudoInicial)
  const [editorKey, setEditorKey]         = useState(0)

  // Painel de revisão automática (validar → corrigir)
  const [painelAberto, setPainelAberto] = useState(false)
  const [validando, setValidando]       = useState(false)
  // Inicia com a revisão automática pós-geração, se já gravada (validarPecaPosStream).
  const [validacao, setValidacao]       = useState<ValidacaoData | null>(validacaoInicial ?? null)
  const [corrigindo, setCorrigindo]     = useState<string | null>(null)
  const { startStream } = useStreaming()

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false)
      }
    }
    if (menuOpen) document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [menuOpen])

  async function handleSalvar(conteudo: string, opts?: { silencioso?: boolean }) {
    const silencioso = opts?.silencioso ?? false
    if (!silencioso) setSalvando(true)
    try {
      const res = await fetch('/api/ia/salvar-peca', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        // Autosave (silencioso) não cria versão; o save manual versiona.
        body:    JSON.stringify({ pecaId, conteudo, semVersao: silencioso }),
      })
      if (res.ok) {
        setConteudoAtual(conteudo)
        if (!silencioso) success('Peça salva!', 'Conteúdo salvo com sucesso.')
      } else {
        const data = await res.json()
        if (!silencioso) toastError('Erro ao salvar', data.error ?? 'Tente novamente')
      }
    } catch {
      if (!silencioso) toastError('Erro', 'Falha de rede')
    } finally {
      if (!silencioso) setSalvando(false)
    }
  }

  // Revisão automática por IA (coerência, citações, score) + checagem
  // determinística de formatação forense. Sob demanda para não gastar cota a
  // cada abertura do editor.
  async function handleRevisar() {
    setValidando(true)
    setPainelAberto(true)
    setValidacao(null)
    try {
      const res = await fetch('/api/ia/validar-peca', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ pecaId }),
      })
      const data = await res.json()
      if (!res.ok) {
        toastError('Erro na revisão', data.error ?? 'Tente novamente')
        setPainelAberto(false)
        return
      }
      setValidacao(data as ValidacaoData)
      setStatus((s) => (s === 'rascunho' ? 'revisada' : s))
    } catch {
      toastError('Erro', 'Falha de rede na revisão')
      setPainelAberto(false)
    } finally {
      setValidando(false)
    }
  }

  // Correção de um clique: reescreve a peça aplicando a correção sugerida,
  // persiste (salvar-peca versiona a anterior) e remonta o editor.
  async function handleCorrecao(tipo: string) {
    setCorrigindo(tipo)
    try {
      const resultado = await startStream('/api/ia/correcao-auto', { pecaId, tipo })
      if (!resultado) {
        toastError('Erro', 'Não foi possível aplicar a correção.')
        return
      }
      const corrigido = formatarPeca(resultado.fullText)
      const res = await fetch('/api/ia/salvar-peca', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ pecaId, conteudo: corrigido }),
      })
      if (!res.ok) {
        const data = await res.json()
        toastError('Erro ao salvar', data.error ?? 'Tente novamente')
        return
      }
      setConteudoAtual(corrigido)
      setEditorKey((k) => k + 1)
      setPainelAberto(false)
      setValidacao(null)
      success('Correção aplicada', 'A peça foi atualizada. Clique em "Revisar peça" para validar de novo.')
    } catch {
      toastError('Erro', 'Falha ao aplicar a correção.')
    } finally {
      setCorrigindo(null)
    }
  }

  async function handleEnviarRevisao(days: number) {
    setMenuOpen(false)
    setEnviando(true)
    try {
      const prazo = new Date()
      prazo.setDate(prazo.getDate() + days)

      const res = await fetch(`/api/pecas/${pecaId}/enviar-revisao`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prazo_revisao: prazo.toISOString() }),
      })
      if (res.ok) {
        setStatus('aguardando_revisao')
        success('Enviada para revisão!', `Prazo: ${days === 1 ? '24 horas' : `${days} dias`}. Tarefa criada no kanban.`)
      } else {
        const data = await res.json()
        toastError('Erro', data.error ?? 'Não foi possível enviar para revisão')
      }
    } catch {
      toastError('Erro', 'Falha de rede')
    } finally {
      setEnviando(false)
    }
  }

  const botaoRevisao = status === 'rascunho' ? (
    <div className="relative" ref={menuRef}>
      <Button
        size="sm"
        variant="accent"
        onClick={() => setMenuOpen(v => !v)}
        disabled={enviando}
        className="gap-1.5"
      >
        <Send className="h-4 w-4" />
        {enviando ? 'Enviando...' : 'Enviar para Revisão'}
      </Button>

      {menuOpen && (
        <div className="absolute right-0 top-full mt-1 z-50 w-52 rounded-lg border border-border bg-card p-2 shadow-elevated">
          <p className="flex items-center gap-1.5 px-2 py-1.5 text-xs font-semibold text-muted-foreground">
            <Clock className="h-3.5 w-3.5" />
            Prazo para revisão
          </p>
          {PRAZO_OPTIONS.map(opt => (
            <button
              key={opt.days}
              onClick={() => handleEnviarRevisao(opt.days)}
              className="flex w-full items-center rounded-md px-2 py-1.5 text-sm text-foreground hover:bg-muted transition-colors"
            >
              {opt.label}
            </button>
          ))}
        </div>
      )}
    </div>
  ) : status === 'aguardando_revisao' ? (
    <div className="flex items-center gap-1.5 rounded-lg bg-warning/10 px-3 py-1.5 text-xs font-medium text-warning">
      <CheckCircle className="h-3.5 w-3.5" />
      Aguardando Revisão
    </div>
  ) : null

  // Badge da revisão automática (aparece quando há score gravado pós-geração).
  const scoreRevisao = validacao?.score_confianca
  const badgeRevisao = scoreRevisao !== undefined && !validando && !painelAberto ? (
    <button
      onClick={() => setPainelAberto(true)}
      title="Ver revisão automática da peça"
      className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-semibold transition-colors ${
        scoreRevisao >= 80
          ? 'bg-success/10 text-success hover:bg-success/20'
          : scoreRevisao >= 60
            ? 'bg-warning/10 text-warning hover:bg-warning/20'
            : 'bg-destructive/10 text-destructive hover:bg-destructive/20'
      }`}
    >
      <ClipboardCheck className="h-3.5 w-3.5" />
      Revisão {scoreRevisao}
    </button>
  ) : null

  const acoes = (
    <div className="flex items-center gap-2">
      {badgeRevisao}
      <Button
        size="sm"
        variant="secondary"
        onClick={handleRevisar}
        disabled={validando || corrigindo !== null}
        className="gap-1.5"
      >
        {validando ? <Loader2 className="h-4 w-4 animate-spin" /> : <ClipboardCheck className="h-4 w-4" />}
        {validando ? 'Revisando...' : 'Revisar peça'}
      </Button>
      {botaoRevisao}
    </div>
  )

  return (
    <>
      <DocumentEditor
        key={editorKey}
        titulo={tipoNome ?? tipo}
        conteudo={conteudoAtual}
        onVoltar={() => {
          router.push(
            clienteId && atendimentoId
              ? `/clientes/${clienteId}/casos/${atendimentoId}`
              : `/${area}`
          )
          router.refresh()
        }}
        onSalvar={handleSalvar}
        salvando={salvando}
        extraAcoes={acoes}
      />

      {/* Painel de revisão automática (validar → corrigir) */}
      {painelAberto && (
        <div className="fixed inset-0 z-50 flex justify-end">
          <div className="absolute inset-0 bg-black/40" onClick={() => !corrigindo && setPainelAberto(false)} />
          <aside className="relative flex w-full max-w-md flex-col overflow-hidden bg-background shadow-2xl">
            <div className="flex items-center justify-between border-b border-border px-4 py-3">
              <h2 className="flex items-center gap-2 font-semibold text-foreground">
                <ClipboardCheck className="h-4 w-4 text-primary" />
                Revisão automática
              </h2>
              <button
                onClick={() => !corrigindo && setPainelAberto(false)}
                className="rounded-md p-1 text-muted-foreground hover:bg-muted disabled:opacity-40"
                disabled={corrigindo !== null}
                aria-label="Fechar"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-4">
              {corrigindo ? (
                <div className="flex flex-col items-center gap-3 py-16 text-center text-muted-foreground">
                  <Loader2 className="h-6 w-6 animate-spin text-primary" />
                  <p className="text-sm">Aplicando correção e reescrevendo a peça...</p>
                </div>
              ) : validando ? (
                <div className="flex flex-col items-center gap-3 py-16 text-center text-muted-foreground">
                  <Loader2 className="h-6 w-6 animate-spin text-primary" />
                  <p className="text-sm">Analisando a peça (coerência, citações e formatação)...</p>
                </div>
              ) : validacao ? (
                <RelatorioValidacao data={validacao} onCorrecao={handleCorrecao} />
              ) : null}
            </div>
          </aside>
        </div>
      )}
    </>
  )
}
