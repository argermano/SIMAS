'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { DocumentEditor } from '@/components/document-editor/DocumentEditor'
import { useToast } from '@/components/ui/toast'

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
}: EditorPecaClientProps) {
  const router = useRouter()
  const { success, error: toastError } = useToast()
  const [salvando, setSalvando] = useState(false)

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

  return (
    <DocumentEditor
      titulo={tipoNome ?? tipo}
      conteudo={conteudoInicial}
      onVoltar={() => router.back()}
      onSalvar={handleSalvar}
      salvando={salvando}
    />
  )
}
