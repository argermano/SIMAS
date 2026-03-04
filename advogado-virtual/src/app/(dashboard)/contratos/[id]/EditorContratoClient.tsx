'use client'

import { useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { DocumentEditor } from '@/components/document-editor/DocumentEditor'
import { Button } from '@/components/ui/button'
import { useToast } from '@/components/ui/toast'
import { ConfirmDialog } from '@/components/ui/dialog'
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from '@/components/ui/dropdown-menu'
import { EnviarAssinaturaModal } from '@/components/contratos/EnviarAssinaturaModal'
import { PainelAssinatura } from '@/components/contratos/PainelAssinatura'
import { CheckCircle, Loader2, PenLine, ChevronDown, FileDown, Monitor } from 'lucide-react'

interface Signer {
  id:           string
  name:         string
  email:        string
  act:          string
  signed:       boolean
  signed_at:    string | null
  signing_link: string | null
  d4sign_key:   string | null
}

interface SignatureData {
  id:              string
  status:          string
  sent_at:         string | null
  completed_at:    string | null
  cancelled_at:    string | null
  cancel_reason:   string | null
  signed_file_url: string | null
  contract_signature_signers: Signer[]
}

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
    clientes: { nome: string; cpf?: string; email?: string; telefone?: string } | null
    atendimentos: { area?: string } | null
  }
  versoes: { id: string; versao: number; created_at: string }[]
  role: string
  assinatura?: SignatureData | null
  tenant?: {
    nome_responsavel?: string | null
    email_profissional?: string | null
    cpf_responsavel?: string | null
    telefone?: string | null
  } | null
}

export function EditorContratoClient({
  contratoId, contrato, role, assinatura: assinaturaInicial, tenant,
}: EditorContratoClientProps) {
  const router = useRouter()
  const { success, error: toastError } = useToast()

  const [salvando,         setSalvando]         = useState(false)
  const [aprovando,        setAprovando]        = useState(false)
  const [status,           setStatus]           = useState(contrato.status)
  const [confirmarAprovar, setConfirmarAprovar] = useState(false)
  const [showAssinar,      setShowAssinar]      = useState(false)
  const [assinatura,       setAssinatura]       = useState<SignatureData | null>(assinaturaInicial ?? null)
  const [baixandoPdf,      setBaixandoPdf]      = useState(false)

  const podeAprovar        = ['admin', 'advogado'].includes(role)
  const temAssinaturaAtiva = assinatura && assinatura.status !== 'cancelled'

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

  const handleBaixarPdf = useCallback(async () => {
    setBaixandoPdf(true)
    try {
      const res = await fetch(`/api/contratos/${contratoId}/exportar-pdf`, { method: 'POST' })
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        toastError('Erro', d.error ?? 'Não foi possível gerar o PDF')
        return
      }
      const blob = await res.blob()
      const url  = URL.createObjectURL(blob)
      const a    = document.createElement('a')
      a.href     = url
      a.download = `${contrato.titulo.replace(/\s+/g, '_')}.pdf`
      a.click()
      URL.revokeObjectURL(url)
      success('PDF gerado!', 'Arquivo baixado para assinatura manual')
    } catch {
      toastError('Erro', 'Falha de rede')
    } finally {
      setBaixandoPdf(false)
    }
  }, [contratoId, contrato.titulo, success, toastError])

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

  const acaoAssinar = !temAssinaturaAtiva ? (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size="sm" className="gap-1.5 bg-violet-700 hover:bg-violet-800">
          <PenLine className="h-4 w-4" />
          Assinar
          <ChevronDown className="h-3.5 w-3.5 ml-0.5" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={handleBaixarPdf} disabled={baixandoPdf}>
          <FileDown className="h-4 w-4" />
          {baixandoPdf ? 'Gerando PDF…' : 'Manual (PDF)'}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => setShowAssinar(true)}>
          <Monitor className="h-4 w-4" />
          Digital (D4Sign)
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
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

      <EnviarAssinaturaModal
        open={showAssinar}
        onClose={() => setShowAssinar(false)}
        contratoId={contratoId}
        tituloContrato={contrato.titulo}
        clienteNome={contrato.clientes?.nome}
        clienteEmail={contrato.clientes?.email}
        clienteCpf={contrato.clientes?.cpf}
        clienteTelefone={contrato.clientes?.telefone}
        tenantNome={tenant?.nome_responsavel}
        tenantEmail={tenant?.email_profissional}
        tenantCpf={tenant?.cpf_responsavel}
        tenantTelefone={tenant?.telefone}
        onSent={() => {
          setShowAssinar(false)
          fetch(`/api/contratos/${contratoId}/assinatura`)
            .then(r => r.json())
            .then(d => { if (d.signature) setAssinatura(d.signature) })
            .catch(() => {})
        }}
      />

      <div className="space-y-6">
        <DocumentEditor
          titulo={contrato.titulo}
          conteudo={contrato.conteudo_markdown}
          onVoltar={() => router.push('/contratos')}
          onSalvar={handleSalvar}
          salvando={salvando}
          extraAcoes={<>{acaoAprovar}{acaoAssinar}</>}
        />

        {temAssinaturaAtiva && (
          <PainelAssinatura
            contratoId={contratoId}
            initial={assinatura!}
          />
        )}
      </div>
    </>
  )
}
