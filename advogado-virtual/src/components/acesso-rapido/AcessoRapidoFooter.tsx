'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { Dialog } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { useToast } from '@/components/ui/toast'
import { MarkdownPreview } from '@/components/ui/markdown-preview'
import { Zap, FileText, Loader2, Copy, Download, Edit3, CheckCircle, Upload, X, ExternalLink, FolderOpen } from 'lucide-react'

type TipoDoc = 'procuracao' | 'declaracao_hipossuficiencia'
type ModalTipo = 'contrato' | 'procuracao' | 'declaracao' | null

interface TemplateContrato {
  id: string
  titulo: string
  created_at: string
}

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
  const [modeloTexto,      setModeloTexto]      = useState('')
  const [uploadandoModelo, setUploadandoModelo] = useState(false)
  const [gerando,          setGerando]          = useState(false)
  const [previewContrato,  setPreviewContrato]  = useState('')
  const [contratoGeradoId, setContratoGeradoId] = useState<string | null>(null)

  // ── Repositório de modelos de contrato ──
  const [modelosSalvos,       setModelosSalvos]       = useState<TemplateContrato[]>([])
  const [modeloSelecionadoId, setModeloSelecionadoId] = useState<string | null>(null)
  const [carregandoModelos,   setCarregandoModelos]   = useState(false)

  // ── Estado compartilhado por procuração e declaração ──
  const [objeto,           setObjeto]           = useState('')
  const [rendaMensal,      setRendaMensal]      = useState('')
  const [templateExiste,   setTemplateExiste]   = useState(false)
  const [gerandoDoc,       setGerandoDoc]       = useState(false)
  const [documentoGerado,  setDocumentoGerado]  = useState('')
  const [templateConteudo, setTemplateConteudo] = useState('')
  const [salvandoTemplate, setSalvandoTemplate] = useState(false)

  // ── Carregar modelos de contrato existentes ──
  const carregarModelos = useCallback(async () => {
    setCarregandoModelos(true)
    try {
      const res = await fetch('/api/templates-contrato')
      const data = await res.json()
      if (data.templates) {
        setModelosSalvos(data.templates)
        // Se há modelos, selecionar o primeiro automaticamente
        if (data.templates.length > 0 && !modeloSelecionadoId) {
          setModeloSelecionadoId(data.templates[0].id)
        }
      }
    } catch { /* silencioso */ }
    finally { setCarregandoModelos(false) }
  }, [modeloSelecionadoId])

  // Carregar modelos ao abrir modal de contrato
  useEffect(() => {
    if (modalAberto === 'contrato') {
      carregarModelos()
    }
  }, [modalAberto, carregarModelos])

  // ── Helpers ──
  function fecharContrato() {
    if (gerando) return
    setModalAberto(null)
    setPreviewContrato('')
    setContratoGeradoId(null)
    setModeloTexto('')
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
    try {
      const formData = new FormData()
      formData.append('modelo', file)
      const res  = await fetch('/api/contratos/upload-modelo', { method: 'POST', body: formData })
      const data = await res.json()
      if (res.ok) {
        setModeloTexto(data.texto_extraido ?? '')
        success('Modelo salvo!', 'O modelo foi salvo e será usado como base.')
        // Recarregar lista e selecionar o novo
        const resModelos = await fetch('/api/templates-contrato')
        const dataM = await resModelos.json()
        if (dataM.templates) {
          setModelosSalvos(dataM.templates)
          if (data.template_id) setModeloSelecionadoId(data.template_id)
        }
      } else {
        toastError('Erro no upload', data.error ?? 'Tente novamente')
      }
    } catch {
      toastError('Erro', 'Falha ao enviar o modelo')
    } finally {
      setUploadandoModelo(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  async function selecionarModelo(id: string | null) {
    setModeloSelecionadoId(id)
    if (!id) {
      setModeloTexto('')
      return
    }
    // Carregar conteúdo do modelo selecionado
    try {
      const res = await fetch(`/api/templates-contrato/${id}`)
      const data = await res.json()
      if (data.template) {
        setModeloTexto(data.template.conteudo_markdown)
      }
    } catch {
      toastError('Erro', 'Falha ao carregar modelo')
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

      // 2. Gerar contrato (com ou sem modelo)
      const resIA = await fetch('/api/ia/gerar-contrato', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          contratoId,
          instrucoes:  instrucoes  || undefined,
          modeloTexto: modeloTexto || undefined,
        }),
      })
      if (!resIA.ok || !resIA.body) { toastError('Erro', 'Falha ao gerar contrato'); return }

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

      // 3. Salvar conteúdo gerado no contrato
      console.log('[AcessoRapido] conteudo length:', conteudo.length, '| contratoId:', contratoId)
      if (conteudo) {
        const resPatch = await fetch(`/api/contratos/${contratoId}`, {
          method:  'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({ conteudo_markdown: conteudo }),
        })
        const dataPatch = await resPatch.json()
        console.log('[AcessoRapido] PATCH response:', resPatch.status, dataPatch)
        if (resPatch.ok) {
          setContratoGeradoId(contratoId)
          success('Contrato gerado!', modeloTexto ? 'Gerado a partir do seu modelo.' : 'Gerado com IA.')
        } else {
          toastError('Erro ao salvar', dataPatch.error ?? 'Não foi possível salvar o contrato gerado')
        }
      } else {
        console.warn('[AcessoRapido] Nenhum conteúdo gerado para salvar!')
        toastError('Aviso', 'Nenhum conteúdo foi gerado. Tente novamente.')
      }
    } catch (err) {
      console.error('[AcessoRapido] ERRO na geração:', err)
      toastError('Erro', err instanceof Error ? err.message : 'Falha de rede')
    }
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

  const temModeloSelecionado = !!modeloSelecionadoId || !!modeloTexto

  return (
    <>
      {/* ── Barra de acesso rápido ── */}
      <div className="rounded-xl border border-gray-200 bg-gray-50 p-4">
        <div className="mb-3 flex items-center gap-2">
          <Zap className="h-4 w-4 text-amber-500" />
          <span className="text-sm font-semibold text-gray-700">Acesso Rápido</span>
        </div>
        <div className="flex flex-wrap gap-3">
          <Button variant="secondary" size="sm" onClick={() => { setPreviewContrato(''); setModeloTexto(''); setModalAberto('contrato') }} className="gap-2">
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
        description={gerando ? 'Gerando contrato — não feche esta janela...' : temModeloSelecionado ? 'Modelo selecionado — será usado como base.' : 'Selecione um modelo ou gere com IA.'}
        size="md"
        footer={
          <>
            <Button variant="secondary" onClick={fecharContrato} disabled={gerando}>
              {contratoGeradoId ? 'Continuar aqui' : 'Fechar'}
            </Button>
            {contratoGeradoId ? (
              <Button onClick={() => { window.location.href = `/contratos/${contratoGeradoId}` }} className="gap-2">
                <ExternalLink className="h-4 w-4" /> Abrir editor
              </Button>
            ) : (
              <Button onClick={gerarContrato} disabled={gerando || !clienteId} className="gap-2 min-w-36">
                {gerando
                  ? <><Loader2 className="h-4 w-4 animate-spin" /> Gerando...</>
                  : temModeloSelecionado
                    ? 'Gerar contrato'
                    : 'Gerar com IA'
                }
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
          {/* ── Seleção de modelo de contrato ── */}
          {!gerando && !previewContrato && (
            <div>
              <p className="mb-1.5 text-xs font-medium text-gray-700">Modelo de contrato</p>

              {carregandoModelos ? (
                <div className="flex items-center gap-2 py-3 text-sm text-gray-400">
                  <Loader2 className="h-4 w-4 animate-spin" /> Carregando modelos...
                </div>
              ) : modelosSalvos.length > 0 ? (
                <div className="space-y-2">
                  {/* Lista de modelos existentes */}
                  <div className="space-y-1.5 max-h-32 overflow-y-auto">
                    {modelosSalvos.map(m => (
                      <button
                        key={m.id}
                        type="button"
                        onClick={() => selecionarModelo(m.id === modeloSelecionadoId ? null : m.id)}
                        className={`flex w-full items-center gap-3 rounded-lg border px-3 py-2.5 text-left text-sm transition-colors ${
                          m.id === modeloSelecionadoId
                            ? 'border-primary-300 bg-primary-50 text-primary-800'
                            : 'border-gray-200 bg-white text-gray-700 hover:border-gray-300'
                        }`}
                      >
                        <FolderOpen className={`h-4 w-4 shrink-0 ${m.id === modeloSelecionadoId ? 'text-primary-600' : 'text-gray-400'}`} />
                        <span className="flex-1 truncate font-medium">{m.titulo}</span>
                        {m.id === modeloSelecionadoId && <CheckCircle className="h-4 w-4 shrink-0 text-primary-600" />}
                      </button>
                    ))}
                  </div>

                  {/* Opção: gerar sem modelo (IA) */}
                  <button
                    type="button"
                    onClick={() => { setModeloSelecionadoId(null); setModeloTexto('') }}
                    className={`flex w-full items-center gap-3 rounded-lg border px-3 py-2.5 text-left text-sm transition-colors ${
                      !modeloSelecionadoId && !modeloTexto
                        ? 'border-violet-300 bg-violet-50 text-violet-800'
                        : 'border-gray-200 bg-white text-gray-500 hover:border-gray-300'
                    }`}
                  >
                    <span className="flex-1">Gerar do zero com IA (sem modelo)</span>
                  </button>

                  {/* Separador + upload de novo modelo */}
                  <div className="flex items-center gap-2 pt-1">
                    <div className="flex-1 border-t border-gray-200" />
                    <span className="text-xs text-gray-400">ou</span>
                    <div className="flex-1 border-t border-gray-200" />
                  </div>
                </div>
              ) : (
                <div className="mb-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm text-amber-700">
                  Nenhum modelo salvo. Envie um modelo abaixo ou gere com IA.
                </div>
              )}

              {/* Upload de novo modelo */}
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={uploadandoModelo}
                className="flex w-full items-center justify-center gap-2 rounded-lg border-2 border-dashed border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-500 hover:border-primary-300 hover:text-primary-700 transition-colors"
              >
                <Upload className="h-4 w-4" />
                {uploadandoModelo ? 'Extraindo texto e salvando...' : 'Enviar novo modelo PDF/DOCX'}
              </button>
              <input ref={fileInputRef} type="file" accept=".pdf,.docx" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) uploadModelo(f) }} />
            </div>
          )}

          {/* Indicador de modelo selecionado durante geração */}
          {gerando && temModeloSelecionado && (
            <div className="flex items-center gap-2 rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-700">
              <CheckCircle className="h-4 w-4 shrink-0" />
              Gerando a partir do modelo selecionado
            </div>
          )}

          <div className="grid grid-cols-2 gap-4">
            <Input label="Honorários fixos (R$)" type="number" value={valorFixo} onChange={e => setValorFixo(e.target.value)} placeholder="Ex.: 3000" disabled={gerando} />
            <Input label="% sobre êxito" type="number" value={percentualExito} onChange={e => setPercentualExito(e.target.value)} placeholder="Ex.: 20" disabled={gerando} />
          </div>

          <Select label="Forma de pagamento" value={formaPagamento} onChange={e => setFormaPagamento(e.target.value)} options={OPCOES_FORMA_PAGAMENTO} placeholder="Selecione..." disabled={gerando} />

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
