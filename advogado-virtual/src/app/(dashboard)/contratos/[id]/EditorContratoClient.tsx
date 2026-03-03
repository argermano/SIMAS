'use client'

import { useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { DocumentEditor } from '@/components/document-editor/DocumentEditor'
import { Button } from '@/components/ui/button'
import { useToast } from '@/components/ui/toast'
import { ConfirmDialog } from '@/components/ui/dialog'
import { CheckCircle, Loader2 } from 'lucide-react'

interface EditorContratoClientProps {
  contratoId: string
  contrato: {
    titulo: string
    area: string | null
    conteudo_markdown: string
    status: string
    versao: number
    valor_fixo: number | null
    percentual_exito: number | null
    forma_pagamento: string | null
    clientes: { nome: string; cpf?: string } | null
    atendimentos: { area?: string } | null
  }
  versoes: { id: string; versao: number; created_at: string }[]
  role: string
}

export function EditorContratoClient({ contratoId, contrato, role }: EditorContratoClientProps) {
  const router = useRouter()
  const { success, error: toastError } = useToast()

  const [salvando,        setSalvando]        = useState(false)
  const [aprovando,       setAprovando]       = useState(false)
  const [status,          setStatus]          = useState(contrato.status)
  const [confirmarAprovar, setConfirmarAprovar] = useState(false)

  const podeAprovar = ['admin', 'advogado'].includes(role)

  const handleSalvar = useCallback(async (conteudo: string) => {
    setSalvando(true)
    try {
      const res  = await fetch(`/api/contratos/${contratoId}`, {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ conteudo_markdown: conteudo }),
      })
      const data = await res.json()
      if (!res.ok) {
        toastError('Erro ao salvar', data.error ?? 'Tente novamente')
      } else {
        success('Salvo!', `Versão ${data.contrato.versao} registrada`)
      }
    } catch {
      toastError('Erro', 'Falha de rede')
    } finally {
      setSalvando(false)
    }
  }, [contratoId, success, toastError])

  const aprovar = useCallback(async () => {
    setAprovando(true)
    try {
      const res  = await fetch(`/api/contratos/${contratoId}/aprovar`, { method: 'POST' })
      const data = await res.json()
      if (!res.ok) {
        toastError('Erro', data.error ?? 'Não foi possível aprovar')
      } else {
        setStatus('aprovado')
        success('Contrato aprovado!', 'O contrato está pronto para exportação')
      }
    } catch {
      toastError('Erro', 'Falha de rede')
    } finally {
      setAprovando(false)
      setConfirmarAprovar(false)
    }
  }, [contratoId, success, toastError])

  const acaoAprovar = podeAprovar && status !== 'aprovado' && status !== 'exportado' ? (
    <Button
      size="sm"
      onClick={() => setConfirmarAprovar(true)}
      disabled={aprovando}
      className="gap-1.5 bg-green-700 hover:bg-green-800"
    >
      {aprovando
        ? <Loader2 className="h-4 w-4 animate-spin" />
        : <CheckCircle className="h-4 w-4" />
      }
      Aprovar
    </Button>
  ) : null

  return (
    <>
      <ConfirmDialog
        open={confirmarAprovar}
        onClose={() => setConfirmarAprovar(false)}
        onConfirm={aprovar}
        title="Aprovar contrato"
        description="Confirma a aprovação deste contrato de honorários? Após aprovado, ele estará pronto para exportação e assinatura."
        confirmLabel="Aprovar"
        loading={aprovando}
      />

      <DocumentEditor
        titulo={contrato.titulo}
        conteudo={contrato.conteudo_markdown}
        onVoltar={() => router.push('/contratos')}
        onSalvar={handleSalvar}
        salvando={salvando}
        extraAcoes={acaoAprovar}
      />
    </>
  )
}
