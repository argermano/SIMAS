'use client'

import { useState, useRef, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { DocumentEditor } from '@/components/document-editor/DocumentEditor'
import { Button } from '@/components/ui/button'
import { useToast } from '@/components/ui/toast'
import { Send, CheckCircle, Clock } from 'lucide-react'

interface EditorPecaClientProps {
  pecaId: string
  atendimentoId: string
  area: string
  tipo: string
  tipoNome: string
  conteudoInicial: string
  versaoInicial: number
  statusInicial: string
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
  tipo,
  tipoNome,
  conteudoInicial,
  statusInicial,
}: EditorPecaClientProps) {
  const router = useRouter()
  const { success, error: toastError } = useToast()
  const [salvando, setSalvando]       = useState(false)
  const [enviando, setEnviando]       = useState(false)
  const [status, setStatus]           = useState(statusInicial)
  const [menuOpen, setMenuOpen]       = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false)
      }
    }
    if (menuOpen) document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [menuOpen])

  async function handleSalvar(conteudo: string) {
    setSalvando(true)
    try {
      const res = await fetch('/api/ia/salvar-peca', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ pecaId, conteudo }),
      })
      if (res.ok) {
        success('Peça salva!', 'Conteúdo salvo com sucesso.')
      } else {
        const data = await res.json()
        toastError('Erro ao salvar', data.error ?? 'Tente novamente')
      }
    } catch {
      toastError('Erro', 'Falha de rede')
    } finally {
      setSalvando(false)
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

  return (
    <DocumentEditor
      titulo={tipoNome ?? tipo}
      conteudo={conteudoInicial}
      onVoltar={() => router.back()}
      onSalvar={handleSalvar}
      salvando={salvando}
      extraAcoes={botaoRevisao}
    />
  )
}
