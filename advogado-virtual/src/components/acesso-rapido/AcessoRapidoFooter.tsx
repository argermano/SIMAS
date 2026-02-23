'use client'

import { useState, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { Dialog } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { useToast } from '@/components/ui/toast'
import { MarkdownPreview } from '@/components/ui/markdown-preview'
import { Zap, FileText, Loader2, Copy, Download, Edit3, CheckCircle, Upload, X, ExternalLink } from 'lucide-react'

type TipoDoc = 'procuracao' | 'declaracao_hipossuficiencia'
type ModalTipo = 'contrato' | 'procuracao' | 'declaracao' | null

const OPCOES_FORMA_PAGAMENTO = [
  { value: 'À vista',            label: 'À vista'           },
  { value: 'Mensal',             label: 'Mensal'            },
  { value: 'Na condenação',      label: 'Na condenação'     },
  { value: 'Entrada + parcelas', label: 'Entrada + parcelas' },
  { value: 'Êxito',              label: 'Somente êxito'     },
]

interface AcessoRapidoFooterProps {
  atendimentoId?: string | null
  clienteId?: string | null
  area?: string
}

export function AcessoRapidoFooter({ atendimentoId, clienteId, area }: AcessoRapidoFooterProps) {
  const router = useRouter()
  const { success, error: toastError } = useToast()
  const fileInputRef = useRef<HTMLInputElement>(null)

  // ── Estado dos modais ──
  const [modalAberto,      setModalAberto]      = useState<ModalTipo>(null)
  const [subModalTemplate, setSubModalTemplate] = useState<TipoDoc | null>(null)

  // ── Estado do modal de contrato ──
  const [valorFixo,        setValorFixo]        = useState('')
  const [percentualExito,  setPercentualExito]  = useState('')
  const [formaPagamento,   setFormaPagamento]   = useState('')
  const [instrucoes,       setInstrucoes]       = useState('')
  const [modeloFile,       setModeloFile]       = useState<File | null>(null)
  const [modeloTexto,      setModeloTexto]      = useState('')
  const [uploadandoModelo, setUploadandoModelo] = useState(false)
  const [gerando,          setGerando]          = useState(false)
  const [previewContrato,  setPreviewContrato]  = useState('')
  const [contratoGeradoId, setContratoGeradoId] = useState<string | null>(null)

  // ── Estado compartilhado por procuração e declaração ──
  const [objeto,           setObjeto]           = useState('')
  const [rendaMensal,      setRendaMensal]      = useState('')
  const [templateExiste,   setTemplateExiste]   = useState(false)
  const [gerandoDoc,       setGerandoDoc]       = useState(false)
  const [documentoGerado,  setDocumentoGerado]  = useState('')
  const [templateConteudo, setTemplateConteudo] = useState('')
  const [salvandoTemplate, setSalvandoTemplate] = useState(false)

  // ── Helpers ──
  function fecharContrato() {
    if (gerando) return // bloqueia fechamento durante geração
    setModalAberto(null)
    setPreviewContrato('')
    setContratoGeradoId(null)
  }

  function resetDocModal() {
    setDocumentoGerado('')
    setObjeto('')
    setRendaMensal('')
    setTemplateExiste(false)
    setTemplateConteudo('')
  }

  async function uploadModelo(file: File) {
    setUploadandoModelo(true)
    setModeloFile(file)
    try {
      const formData = new FormData()
      formData.append('modelo', file)
      const res  = await fetch('/api/contratos/upload-modelo', { method: 'POST', body: formData })
      const data = await res.json()
      if (res.ok) {
        setModeloTexto(data.texto_extraido ?? '')
        success('Modelo carregado', 'O estilo será aplicado ao contrato gerado')
      } else {
        toastError('Erro no upload', data.error ?? 'Tente novamente')
        setModeloFile(null)
      }
    } catch {
      toastError('Erro', 'Falha ao enviar o modelo')
      setModeloFile(null)
    } finally {
      setUploadandoModelo(false)
    }
  }

  async function abrirModalDoc(tipo: 'procuracao' | 'declaracao') {
    resetDocModal()
    setModalAberto(tipo)
    const tipoApi: TipoDoc = tipo === 'declaracao' ? 'declaracao_hipossuficiencia' : 'procuracao'
    try {
      const res  = await fetch(`/api/templates/${tipoApi}`)
      const data = await res.json()
      if (data.template) {
        setTemplateExiste(true)
        setTemplateConteudo(data.template.conteudo_markdown)
      }
    } catch { /* silencioso */ }
  }

  // ── Gerar contrato ──
  async function gerarContrato() {
    if (!clienteId) {
      toastError('Atenção', 'Selecione um cliente para gerar o contrato')
      return
    }

    setGerando(true)
    setPreviewContrato('')

    try {
      // 1. Criar contrato
      const resC = await fetch('/api/contratos', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          cliente_id:       clienteId,
          atendimento_id:   atendimentoId || null,
          area:             area || null,
          valor_fixo:       valorFixo       ? parseFloat(valorFixo)       : null,
          percentual_exito: percentualExito ? parseFloat(percentualExito) : null,
          forma_pagamento:  formaPagamento  || null,
        }),
      })
      const dataC = await resC.json()
      if (!resC.ok) { toastError('Erro', dataC.error ?? 'Falha ao criar contrato'); return }
      const contratoId = dataC.contrato.id

      // 2. Gerar com IA (streaming)
      const resIA = await fetch('/api/ia/gerar-contrato', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          contratoId,
          instrucoes:  instrucoes  || undefined,
          modeloTexto: modeloTexto || undefined,
        }),
      })
      if (!resIA.ok || !resIA.body) { toastError('Erro', 'Falha ao gerar contrato com IA'); return }

      const reader  = resIA.body.getReader()
      const decoder = new TextDecoder()
      let conteudo  = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        const chunk = decoder.decode(value, { stream: true })
        for (const line of chunk.split('\n')) {
          if (!line.startsWith('data: ')) continue
          try {
            const ev = JSON.parse(line.slice(6))
            if (ev.type === 'text') { conteudo += ev.text; setPreviewContrato(conteudo) }
          } catch { /* linha parcial */ }
        }
      }

      // 3. Salvar e mostrar opções (sem navegar para fora)
      if (conteudo) {
        await fetch(`/api/contratos/${contratoId}`, {
          method:  'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({ conteudo_markdown: conteudo }),
        })
        setContratoGeradoId(contratoId)
        success('Contrato gerado!', 'Abra o editor quando quiser.')
      }
    } catch { toastError('Erro', 'Falha de rede') }
    finally   { setGerando(false) }
  }

  // ── Gerar documento (procuração ou declaração) ──
  async function gerarDocumento(tipo: 'procuracao' | 'declaracao') {
    if (!clienteId) {
      toastError('Atenção', 'Selecione um cliente para gerar o documento')
      return
    }

    setGerandoDoc(true)
    const tipoApi: TipoDoc = tipo === 'declaracao' ? 'declaracao_hipossuficiencia' : 'procuracao'
    const camposExtras: Record<string, string> = {}
    if (objeto)      camposExtras.objeto       = objeto
    if (rendaMensal) camposExtras.renda_mensal = rendaMensal

    try {
      const res = await fetch('/api/ia/gerar-documento', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          tipo: tipoApi,
          clienteId,
          atendimentoId: atendimentoId || null,
          camposExtras:  Object.keys(camposExtras).length > 0 ? camposExtras : undefined,
        }),
      })
      const data = await res.json()
      if (!res.ok) { toastError('Erro', data.error ?? 'Falha ao gerar documento'); return }

      setDocumentoGerado(data.conteudo)
      setTemplateConteudo(data.conteudo)
      setTemplateExiste(true)
      if (!data.templateExistia) success('Template salvo!', 'Próximas gerações serão mais rápidas e sem IA.')
    } catch { toastError('Erro', 'Falha de rede') }
    finally   { setGerandoDoc(false) }
  }

  // ── Salvar template editado ──
  async function salvarTemplate(tipo: TipoDoc) {
    setSalvandoTemplate(true)
    try {
      const res = await fetch(`/api/templates/${tipo}`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ conteudo_markdown: templateConteudo }),
      })
      if (res.ok) {
        success('Template salvo!', 'Próximas gerações usarão este modelo.')
        setSubModalTemplate(null)
      } else {
        const data = await res.json()
        toastError('Erro', data.error ?? 'Falha ao salvar template')
      }
    } catch { toastError('Erro', 'Falha de rede') }
    finally   { setSalvandoTemplate(false) }
  }

  function copiar() {
    navigator.clipboard.writeText(documentoGerado)
    success('Copiado!', 'Conteúdo copiado para a área de transferência')
  }

  function baixar(nome: string) {
    const blob = new Blob([documentoGerado], { type: 'text/markdown' })
    const url  = URL.createObjectURL(blob)
    const a    = document.createElement('a')
    a.href     = url
    a.download = `${nome}-${Date.now()}.md`
    a.click()
    URL.revokeObjectURL(url)
  }

  // ── Modal de documento (reutilizado por procuração e declaração) ──
  function ModalDocumento({ tipo }: { tipo: 'procuracao' | 'declaracao' }) {
    const tipoDoc: TipoDoc = tipo === 'declaracao' ? 'declaracao_hipossuficiencia' : 'procuracao'
    const titulo           = tipo === 'procuracao' ? 'Gerar Procuração Ad Judicia' : 'Gerar Declaração de Hipossuficiência'
    const nomeBaixar       = tipo === 'procuracao' ? 'procuracao' : 'declaracao-hipossuficiencia'

    return (
      <Dialog
        open={modalAberto === tipo}
        onClose={() => { setModalAberto(null); resetDocModal() }}
        title={titulo}
        size="lg"
        footer={
          <>
            <Button variant="secondary" onClick={() => { setModalAberto(null); resetDocModal() }} disabled={gerandoDoc}>
              Fechar
            </Button>
            {documentoGerado && (
              <>
                <Button variant="secondary" onClick={copiar} className="gap-1.5">
                  <Copy className="h-4 w-4" /> Copiar
                </Button>
                <Button variant="secondary" onClick={() => baixar(nomeBaixar)} className="gap-1.5">
                  <Download className="h-4 w-4" /> Baixar
                </Button>
                <Button variant="secondary" onClick={() => setSubModalTemplate(tipoDoc)} className="gap-1.5">
                  <Edit3 className="h-4 w-4" /> Editar template
                </Button>
              </>
            )}
            {!documentoGerado && (
              <Button onClick={() => gerarDocumento(tipo)} disabled={gerandoDoc || !clienteId} className="min-w-24">
                {gerandoDoc ? <><Loader2 className="h-4 w-4 animate-spin mr-1.5" />Gerando...</> : 'Gerar'}
              </Button>
            )}
          </>
        }
      >
        {!clienteId && (
          <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm text-amber-700">
            Selecione um cliente na página para gerar este documento.
          </div>
        )}
        {clienteId && templateExiste && !documentoGerado && (
          <div className="mb-4 flex items-center gap-2 rounded-lg border border-green-200 bg-green-50 px-3 py-2.5 text-sm text-green-700">
            <CheckCircle className="h-4 w-4 shrink-0" />
            Template salvo — geração instantânea sem IA
          </div>
        )}
        {clienteId && !templateExiste && !documentoGerado && (
          <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm text-amber-700">
            Nenhum template salvo. A IA irá gerar e salvar automaticamente para uso futuro.
          </div>
        )}
        <div className="space-y-4">
          {!documentoGerado && tipo === 'procuracao' && (
            <Input
              label="Objeto da procuração (opcional)"
              value={objeto}
              onChange={e => setObjeto(e.target.value)}
              placeholder="Ex.: Representação judicial em ação previdenciária"
            />
          )}
          {!documentoGerado && tipo === 'declaracao' && (
            <Input
              label="Renda mensal aproximada (opcional)"
              value={rendaMensal}
              onChange={e => setRendaMensal(e.target.value)}
              placeholder="Ex.: R$ 1.500,00"
            />
          )}
          {documentoGerado && (
            <div>
              <p className="mb-1.5 text-xs font-medium text-gray-500">Documento gerado</p>
              <textarea
                readOnly
                value={documentoGerado}
                className="h-80 w-full resize-none rounded-lg border bg-gray-50 p-3 font-mono text-xs text-gray-700 leading-relaxed"
              />
            </div>
          )}
        </div>
      </Dialog>
    )
  }

  return (
    <>
      {/* ── Barra de acesso rápido ── */}
      <div className="rounded-xl border border-gray-200 bg-gray-50 p-4">
        <div className="mb-3 flex items-center gap-2">
          <Zap className="h-4 w-4 text-amber-500" />
          <span className="text-sm font-semibold text-gray-700">Acesso Rápido</span>
        </div>
        <div className="flex flex-wrap gap-3">
          <Button variant="secondary" size="sm" onClick={() => { setPreviewContrato(''); setModalAberto('contrato') }} className="gap-2">
            <FileText className="h-4 w-4" /> Contrato de Honorários
          </Button>
          <Button variant="secondary" size="sm" onClick={() => abrirModalDoc('procuracao')} className="gap-2">
            <FileText className="h-4 w-4" /> Procuração
          </Button>
          <Button variant="secondary" size="sm" onClick={() => abrirModalDoc('declaracao')} className="gap-2">
            <FileText className="h-4 w-4" /> Decl. Hipossuficiência
          </Button>
        </div>
      </div>

      {/* ── Modal A: Contrato de Honorários ── */}
      <Dialog
        open={modalAberto === 'contrato'}
        onClose={fecharContrato}
        title="Gerar Contrato de Honorários"
        description={gerando ? 'Gerando com IA — não feche esta janela...' : 'Preencha os dados e clique em Gerar com IA'}
        size="md"
        footer={
          <>
            <Button variant="secondary" onClick={fecharContrato} disabled={gerando}>
              {contratoGeradoId ? 'Continuar aqui' : 'Fechar'}
            </Button>
            {contratoGeradoId ? (
              <Button onClick={() => router.push(`/contratos/${contratoGeradoId}`)} className="gap-2">
                <ExternalLink className="h-4 w-4" /> Abrir editor
              </Button>
            ) : (
              <Button onClick={gerarContrato} disabled={gerando || !clienteId} className="gap-2 min-w-36">
                {gerando ? <><Loader2 className="h-4 w-4 animate-spin" /> Gerando...</> : 'Gerar com IA'}
              </Button>
            )}
          </>
        }
      >
        {!clienteId && (
          <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm text-amber-700">
            Selecione um cliente na página para gerar o contrato.
          </div>
        )}

        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <Input label="Honorários fixos (R$)" type="number" value={valorFixo} onChange={e => setValorFixo(e.target.value)} placeholder="Ex.: 3000" disabled={gerando} />
            <Input label="% sobre êxito" type="number" value={percentualExito} onChange={e => setPercentualExito(e.target.value)} placeholder="Ex.: 20" disabled={gerando} />
          </div>

          <Select label="Forma de pagamento" value={formaPagamento} onChange={e => setFormaPagamento(e.target.value)} options={OPCOES_FORMA_PAGAMENTO} placeholder="Selecione..." disabled={gerando} />

          {/* Upload de modelo próprio */}
          {!gerando && (
            <div>
              <p className="mb-1.5 text-xs font-medium text-gray-700">Seu modelo de contrato (opcional)</p>
              {!modeloFile ? (
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploadandoModelo}
                  className="flex w-full items-center justify-center gap-2 rounded-lg border-2 border-dashed border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-500 hover:border-primary-300 hover:text-primary-700 transition-colors"
                >
                  <Upload className="h-4 w-4" />
                  {uploadandoModelo ? 'Extraindo texto...' : 'Enviar modelo PDF/DOCX — a IA replicará o estilo'}
                </button>
              ) : (
                <div className="flex items-center gap-3 rounded-lg border border-green-200 bg-green-50 px-3 py-2">
                  <FileText className="h-4 w-4 text-green-600 shrink-0" />
                  <p className="flex-1 truncate text-sm font-medium text-green-800">{modeloFile.name}</p>
                  <button onClick={() => { setModeloFile(null); setModeloTexto('') }} className="text-green-600 hover:text-green-800">
                    <X className="h-4 w-4" />
                  </button>
                </div>
              )}
              <input ref={fileInputRef} type="file" accept=".pdf,.docx" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) uploadModelo(f) }} />
            </div>
          )}

          {/* Instruções adicionais */}
          {!gerando && (
            <Textarea
              label="Instruções adicionais (opcional)"
              value={instrucoes}
              onChange={e => setInstrucoes(e.target.value)}
              placeholder="Ex.: Incluir cláusula de mediação. Foro em São Paulo. Prazo de vigência de 2 anos."
              rows={2}
            />
          )}

          {/* Preview streaming */}
          {previewContrato && (
            <div>
              <p className="mb-1.5 text-xs font-medium text-gray-500">Prévia do contrato</p>
              <div className="max-h-64 overflow-y-auto rounded-lg border bg-gray-50 p-4">
                <MarkdownPreview>{previewContrato}</MarkdownPreview>
                {gerando && <span className="inline-block h-3.5 w-0.5 animate-pulse bg-primary-600 ml-0.5 align-middle" />}
              </div>
            </div>
          )}
        </div>
      </Dialog>

      {/* ── Modais B e C: Procuração e Declaração ── */}
      <ModalDocumento tipo="procuracao" />
      <ModalDocumento tipo="declaracao" />

      {/* ── Sub-modal: Editar Template ── */}
      <Dialog
        open={subModalTemplate !== null}
        onClose={() => setSubModalTemplate(null)}
        title="Editar Template"
        description="Use {{variavel}} para campos dinâmicos: {{nome_cliente}}, {{cpf_cliente}}, {{data_extenso}}, {{nome_advogado}}, etc."
        size="lg"
        footer={
          <>
            <Button variant="secondary" onClick={() => setSubModalTemplate(null)} disabled={salvandoTemplate}>Cancelar</Button>
            <Button onClick={() => subModalTemplate && salvarTemplate(subModalTemplate)} disabled={salvandoTemplate}>
              {salvandoTemplate ? <><Loader2 className="h-4 w-4 animate-spin mr-1.5" />Salvando...</> : 'Salvar template'}
            </Button>
          </>
        }
      >
        <textarea
          value={templateConteudo}
          onChange={e => setTemplateConteudo(e.target.value)}
          className="h-96 w-full resize-none rounded-lg border bg-white p-3 font-mono text-xs text-gray-700 leading-relaxed focus:outline-none focus:ring-2 focus:ring-primary-300"
          placeholder="Cole ou edite o template em Markdown..."
        />
      </Dialog>
    </>
  )
}
