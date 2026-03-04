'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { DocumentEditor } from '@/components/document-editor/DocumentEditor'
import { Button } from '@/components/ui/button'
import { useToast } from '@/components/ui/toast'
import { Send, CheckCircle } from 'lucide-react'

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

export function EditorPecaClient({
  pecaId,
  tipo,
  tipoNome,
  conteudoInicial,
  statusInicial,
}: EditorPecaClientProps) {
  const router = useRouter()
  const { success, error: toastError } = useToast()
  const [salvando, setSalvando] = useState(false)
  const [enviando, setEnviando] = useState(false)
  const [status, setStatus]     = useState(statusInicial)

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

  async function handleEnviarRevisao() {
    setEnviando(true)
    try {
      const res = await fetch(`/api/pecas/${pecaId}/enviar-revisao`, { method: 'POST' })
      if (res.ok) {
        setStatus('aguardando_revisao')
        success('Enviada para revisão!', 'A peça foi enviada para a fila de revisão.')
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
    <Button
      size="sm"
      variant="accent"
      onClick={handleEnviarRevisao}
      disabled={enviando}
      className="gap-1.5"
    >
      <Send className="h-4 w-4" />
      {enviando ? 'Enviando...' : 'Enviar para Revisão'}
    </Button>
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
