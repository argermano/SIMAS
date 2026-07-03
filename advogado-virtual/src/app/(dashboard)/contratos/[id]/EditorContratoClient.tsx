'use client'

import { useState, useCallback, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { DocumentEditor } from '@/components/document-editor/DocumentEditor'
import { Button } from '@/components/ui/button'
import { useToast } from '@/components/ui/toast'
import { ConfirmDialog } from '@/components/ui/dialog'
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from '@/components/ui/dropdown-menu'
import { EnviarAssinaturaModal } from '@/components/contratos/EnviarAssinaturaModal'
import { PainelAssinatura } from '@/components/contratos/PainelAssinatura'
import { createClient } from '@/lib/supabase/client'
import { formatarDataHora } from '@/lib/utils'
import { CheckCircle, Loader2, PenLine, ChevronDown, FileDown, Monitor, FileText, Upload, Download, FileSignature } from 'lucide-react'

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
    assinado_em?: string | null
    arquivo_assinado_nome?: string | null
    clientes: { nome: string; cpf?: string; email?: string; telefone?: string } | null
    atendimentos: { area?: string } | null
  }
  versoes: { id: string; versao: number; created_at: string }[]
  role: string
  atendimentoId?: string | null
  assinatura?: SignatureData | null
  tenant?: {
    nome_responsavel?: string | null
    email_profissional?: string | null
    cpf_responsavel?: string | null
    telefone?: string | null
  } | null
}

export function EditorContratoClient({
  contratoId, contrato, role, atendimentoId, assinatura: assinaturaInicial, tenant,
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
  const [baixandoModelo,   setBaixandoModelo]   = useState(false)
  const [confirmarAssinado, setConfirmarAssinado] = useState(false)
  const [marcandoAssinado, setMarcandoAssinado] = useState(false)
  const [importando,       setImportando]       = useState(false)
  const [arquivoNome,      setArquivoNome]       = useState<string | null>(contrato.arquivo_assinado_nome ?? null)
  const [assinadoEm,       setAssinadoEm]        = useState<string | null>(contrato.assinado_em ?? null)
  const inputAssinadoRef = useRef<HTMLInputElement>(null)

  const podeAprovar        = ['admin', 'advogado'].includes(role)
  const temAssinaturaAtiva = assinatura && assinatura.status !== 'cancelled'
  const jaAssinado         = status === 'assinado'

  // Confirma assinatura manual (sem arquivo)
  const marcarAssinado = useCallback(async () => {
    setMarcandoAssinado(true)
    try {
      const res  = await fetch(`/api/contratos/${contratoId}/marcar-assinado`, { method: 'POST' })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        toastError('Erro', data.error ?? 'Não foi possível marcar como assinado')
        return
      }
      setStatus('assinado')
      setAssinadoEm(data.contrato?.assinado_em ?? new Date().toISOString())
      success('Contrato assinado!', 'Marcado como assinado.')
      router.refresh()
    } catch {
      toastError('Erro', 'Falha de rede')
    } finally {
      setMarcandoAssinado(false)
      setConfirmarAssinado(false)
    }
  }, [contratoId, router, success, toastError])

  // Importa o contrato assinado (upload via signed URL) e marca como assinado
  const importarAssinado = useCallback(async (file: File) => {
    setImportando(true)
    try {
      // 1. Pede a signed URL de upload
      const resUrl = await fetch(`/api/contratos/${contratoId}/arquivo-assinado`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fileName: file.name, fileType: file.type || 'application/octet-stream', fileSize: file.size }),
      })
      const dataUrl = await resUrl.json().catch(() => ({}))
      if (!resUrl.ok) {
        toastError('Erro', dataUrl.error ?? 'Não foi possível preparar o upload')
        return
      }

      // 2. Sobe o arquivo direto ao Storage
      const supabase = createClient()
      const { error: upErr } = await supabase.storage
        .from('documentos')
        .uploadToSignedUrl(dataUrl.storagePath, dataUrl.uploadToken, file, {
          contentType: file.type || 'application/octet-stream',
        })
      if (upErr) {
        toastError('Erro', 'Falha ao enviar o arquivo')
        return
      }

      // 3. Confirma e marca como assinado
      const resConfirm = await fetch(`/api/contratos/${contratoId}/arquivo-assinado`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ storagePath: dataUrl.storagePath, fileName: file.name }),
      })
      const dataConfirm = await resConfirm.json().catch(() => ({}))
      if (!resConfirm.ok) {
        toastError('Erro', dataConfirm.error ?? 'Falha ao registrar o contrato assinado')
        return
      }

      setStatus('assinado')
      setArquivoNome(file.name)
      setAssinadoEm(dataConfirm.contrato?.assinado_em ?? new Date().toISOString())
      success('Contrato assinado importado!', `"${file.name}" anexado e marcado como assinado.`)
      router.refresh()
    } catch {
      toastError('Erro', 'Falha de rede ao importar o arquivo')
    } finally {
      setImportando(false)
      if (inputAssinadoRef.current) inputAssinadoRef.current.value = ''
    }
  }, [contratoId, router, success, toastError])

  // Baixa o contrato assinado importado
  const baixarAssinado = useCallback(async () => {
    try {
      const res  = await fetch(`/api/contratos/${contratoId}/arquivo-assinado`)
      const data = await res.json().catch(() => ({}))
      if (!res.ok || !data.url) {
        toastError('Erro', data.error ?? 'Não foi possível baixar o arquivo')
        return
      }
      window.open(data.url, '_blank', 'noopener')
    } catch {
      toastError('Erro', 'Falha de rede')
    }
  }, [contratoId, toastError])

  const handleSalvar = useCallback(async (conteudo: string, opts?: { silencioso?: boolean }) => {
    const silencioso = opts?.silencioso ?? false
    if (!silencioso) setSalvando(true)
    try {
      const res  = await fetch(`/api/contratos/${contratoId}`, {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        // Autosave (silencioso) não versiona; o save manual versiona.
        body:    JSON.stringify({ conteudo_markdown: conteudo, semVersao: silencioso }),
      })
      const data = await res.json()
      if (!res.ok) {
        if (!silencioso) toastError('Erro ao salvar', data.error ?? 'Tente novamente')
      } else if (!silencioso) {
        success('Salvo!', `Versão ${data.contrato.versao} registrada`)
      }
    } catch {
      if (!silencioso) toastError('Erro', 'Falha de rede')
    } finally {
      if (!silencioso) setSalvando(false)
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

  // Preenche o modelo .docx do escritório (com {{placeholders}}) — fidelidade 1:1
  const handleBaixarModelo = useCallback(async () => {
    setBaixandoModelo(true)
    try {
      const res = await fetch(`/api/contratos/${contratoId}/exportar-modelo`, { method: 'POST' })
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        toastError('Modelo não disponível', d.error ?? 'Não foi possível gerar o documento')
        return
      }
      const blob = await res.blob()
      const url  = URL.createObjectURL(blob)
      const a    = document.createElement('a')
      a.href     = url
      a.download = `${contrato.titulo.replace(/\s+/g, '_')}_modelo.docx`
      a.click()
      URL.revokeObjectURL(url)
      success('DOCX gerado!', 'Modelo do escritório preenchido')
    } catch {
      toastError('Erro', 'Falha de rede')
    } finally {
      setBaixandoModelo(false)
    }
  }, [contratoId, contrato.titulo, success, toastError])

  const acaoAprovar = podeAprovar && status !== 'aprovado' && status !== 'exportado' ? (
    <Button
      size="sm"
      onClick={() => setConfirmarAprovar(true)}
      disabled={aprovando}
      className="gap-1.5 bg-success hover:bg-success/90"
    >
      {aprovando
        ? <Loader2 className="h-4 w-4 animate-spin" />
        : <CheckCircle className="h-4 w-4" />
      }
      Aprovar
    </Button>
  ) : null

  const acaoAssinar = !temAssinaturaAtiva && !jaAssinado ? (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size="sm" className="gap-1.5 bg-primary/80 hover:bg-primary">
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
        <DropdownMenuItem onClick={handleBaixarModelo} disabled={baixandoModelo}>
          <FileText className="h-4 w-4" />
          {baixandoModelo ? 'Preenchendo…' : 'Meu modelo (.docx)'}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => setShowAssinar(true)}>
          <Monitor className="h-4 w-4" />
          Digital (D4Sign)
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => setConfirmarAssinado(true)}>
          <CheckCircle className="h-4 w-4" />
          Marcar como assinado
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => inputAssinadoRef.current?.click()} disabled={importando}>
          <Upload className="h-4 w-4" />
          {importando ? 'Importando…' : 'Importar contrato assinado'}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  ) : null

  // Quando já assinado: indicador + baixar/substituir o arquivo assinado
  const acaoAssinado = jaAssinado ? (
    <div className="flex items-center gap-2">
      <span className="inline-flex items-center gap-1.5 rounded-lg bg-success/10 px-3 py-1.5 text-xs font-medium text-success">
        <FileSignature className="h-3.5 w-3.5" />
        Assinado{assinadoEm ? ` · ${formatarDataHora(assinadoEm)}` : ''}
      </span>
      {arquivoNome ? (
        <Button size="sm" variant="secondary" onClick={baixarAssinado} className="gap-1.5">
          <Download className="h-4 w-4" />
          Baixar assinado
        </Button>
      ) : (
        <Button size="sm" variant="secondary" onClick={() => inputAssinadoRef.current?.click()} disabled={importando} className="gap-1.5">
          <Upload className="h-4 w-4" />
          {importando ? 'Importando…' : 'Importar assinado'}
        </Button>
      )}
    </div>
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

      <ConfirmDialog
        open={confirmarAssinado}
        onClose={() => setConfirmarAssinado(false)}
        onConfirm={marcarAssinado}
        title="Marcar como assinado"
        description="Confirma que este contrato já foi assinado? Ele sairá da lista de pendentes. Você também pode importar o arquivo assinado pelo menu Assinar."
        confirmLabel="Confirmar assinatura"
        loading={marcandoAssinado}
      />

      {/* Input oculto para importar o contrato assinado (PDF/imagem/DOCX) */}
      <input
        ref={inputAssinadoRef}
        type="file"
        accept=".pdf,.jpg,.jpeg,.png,.docx"
        className="hidden"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) importarAssinado(f) }}
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
          onVoltar={() => { if (atendimentoId) { router.back(); router.refresh() } else router.push('/contratos') }}
          onSalvar={handleSalvar}
          salvando={salvando}
          extraAcoes={<>{acaoAprovar}{acaoAssinar}{acaoAssinado}</>}
          exportOpts={{ contrato: true }}
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
