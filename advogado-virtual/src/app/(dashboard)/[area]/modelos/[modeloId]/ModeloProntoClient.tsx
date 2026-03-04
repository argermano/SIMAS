'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { useToast } from '@/components/ui/toast'
import { SeletorCliente } from '@/components/atendimento/SeletorCliente'
import { EditorDocumentoPronto } from '@/components/documentos/EditorDocumentoPronto'
import {
  Users, FileText, CheckCircle, AlertCircle, Trash2,
  Upload, Edit3, Loader2, Save, X, Zap,
} from 'lucide-react'

// ── Tipos e constantes ────────────────────────────────────────────────────────

type TipoModelo =
  | 'procuracao'
  | 'declaracao_hipossuficiencia'
  | 'substabelecimento'
  | 'notificacao_extrajudicial'
  | 'contrato_honorarios'

const OPCOES_PAGAMENTO = [
  { value: 'À vista',            label: 'À vista'            },
  { value: 'Mensal',             label: 'Mensal'             },
  { value: 'Na condenação',      label: 'Na condenação'      },
  { value: 'Entrada + parcelas', label: 'Entrada + parcelas' },
  { value: 'Êxito',             label: 'Somente êxito'      },
]

// ── Props ─────────────────────────────────────────────────────────────────────

interface ModeloProntoClientProps {
  tipo: string
  tipoNome: string
  clienteIdInicial?: string
}

// ── Componente ────────────────────────────────────────────────────────────────

export function ModeloProntoClient({ tipo, tipoNome, clienteIdInicial }: ModeloProntoClientProps) {
  const tipoModelo = tipo as TipoModelo
  const { success, error: toastError } = useToast()
  const fileInputRef = useRef<HTMLInputElement>(null)

  // ── Estado do cliente ──
  const [cliente, setCliente] = useState<{ id: string; nome: string } | null>(null)

  // ── Estado do template ──
  const [templateExiste, setTemplateExiste]     = useState(false)
  const [templateConteudo, setTemplateConteudo] = useState('')
  const [carregandoTemplate, setCarregandoTemplate] = useState(true)
  const [editandoTemplate, setEditandoTemplate] = useState(false)
  const [templateRascunho, setTemplateRascunho] = useState('')
  const [salvandoTemplate, setSalvandoTemplate] = useState(false)
  const [deletandoTemplate, setDeletandoTemplate] = useState(false)
  const [uploadando, setUploadando]             = useState(false)

  // ── Estado de geração ──
  const [documentoGerado, setDocumentoGerado] = useState('')
  const [gerando, setGerando]                 = useState(false)
  const [modoEditor, setModoEditor]           = useState(false)

  // ── Campos extras por tipo ──
  const [objeto, setObjeto]                         = useState('')           // procuracao
  const [rendaMensal, setRendaMensal]               = useState('')           // declaracao
  const [nomeSubstabelecido, setNomeSubstabelecido] = useState('')           // substabelecimento
  const [oabSubstabelecido, setOabSubstabelecido]   = useState('')           // substabelecimento
  const [objetoNotificacao, setObjetoNotificacao]   = useState('')           // notificacao
  const [prazoResposta, setPrazoResposta]           = useState('15')         // notificacao
  const [valorFixo, setValorFixo]                   = useState('')           // contrato_honorarios
  const [percentualExito, setPercentualExito]       = useState('')           // contrato_honorarios
  const [formaPagamento, setFormaPagamento]         = useState('')           // contrato_honorarios

  // ── Carregar template salvo ao montar ──
  const carregarTemplate = useCallback(async () => {
    setCarregandoTemplate(true)
    try {
      const res = await fetch(`/api/templates/${tipoModelo}`)
      const data = await res.json()
      if (data.template) {
        setTemplateExiste(true)
        setTemplateConteudo(data.template.conteudo_markdown)
      } else {
        setTemplateExiste(false)
        setTemplateConteudo('')
      }
    } catch { /* silencioso */ }
    finally { setCarregandoTemplate(false) }
  }, [tipoModelo])

  useEffect(() => { carregarTemplate() }, [carregarTemplate])

  // ── Pré-selecionar cliente quando vindo via searchParam ──
  useEffect(() => {
    if (!clienteIdInicial) return
    fetch(`/api/clientes/${clienteIdInicial}`)
      .then(r => r.json())
      .then(data => {
        const c = data.cliente
        if (c?.id && c?.nome) setCliente({ id: c.id, nome: c.nome })
      })
      .catch(() => { /* silencioso */ })
  }, [clienteIdInicial])

  // ── Upload de PDF/DOCX para extrair texto do modelo ──
  async function handleUpload(file: File) {
    setUploadando(true)
    try {
      const formData = new FormData()
      formData.append('modelo', file)
      const res = await fetch('/api/contratos/upload-modelo', { method: 'POST', body: formData })
      const data = await res.json()
      if (res.ok && data.texto_extraido) {
        setTemplateRascunho(data.texto_extraido)
        success('Modelo extraído!', 'Revise o conteúdo e salve o modelo.')
      } else {
        toastError('Erro no upload', data.error ?? 'Tente novamente')
      }
    } catch {
      toastError('Erro', 'Falha ao enviar o arquivo')
    } finally {
      setUploadando(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  // ── Salvar template ──
  async function salvarTemplate() {
    if (!templateRascunho.trim()) {
      toastError('Atenção', 'O modelo não pode estar vazio')
      return
    }
    setSalvandoTemplate(true)
    try {
      const res = await fetch(`/api/templates/${tipoModelo}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ conteudo_markdown: templateRascunho }),
      })
      if (res.ok) {
        setTemplateExiste(true)
        setTemplateConteudo(templateRascunho)
        setEditandoTemplate(false)
        success('Modelo salvo!', 'Próximas gerações usarão este modelo.')
      } else {
        const data = await res.json()
        toastError('Erro', data.error ?? 'Falha ao salvar')
      }
    } catch {
      toastError('Erro', 'Falha de rede')
    } finally {
      setSalvandoTemplate(false) }
  }

  // ── Excluir template ──
  async function excluirTemplate() {
    setDeletandoTemplate(true)
    try {
      const res = await fetch(`/api/templates/${tipoModelo}`, { method: 'DELETE' })
      if (res.ok) {
        setTemplateExiste(false)
        setTemplateConteudo('')
        setEditandoTemplate(false)
        setTemplateRascunho('')
        success('Modelo excluído', 'A próxima geração usará IA.')
      } else {
        const data = await res.json()
        toastError('Erro', data.error ?? 'Falha ao excluir')
      }
    } catch {
      toastError('Erro', 'Falha de rede')
    } finally {
      setDeletandoTemplate(false) }
  }

  // ── Gerar documento ──
  async function gerar() {
    if (!cliente) {
      toastError('Atenção', 'Selecione um cliente para gerar o documento')
      return
    }
    setGerando(true)
    setDocumentoGerado('')
    try {
      const camposExtras: Record<string, string> = {}
      if (objeto)              camposExtras.objeto               = objeto
      if (rendaMensal)         camposExtras.renda_mensal         = rendaMensal
      if (nomeSubstabelecido)  camposExtras.nome_substabelecido  = nomeSubstabelecido
      if (oabSubstabelecido)   camposExtras.oab_substabelecido   = oabSubstabelecido
      if (objetoNotificacao)   camposExtras.objeto_notificacao   = objetoNotificacao
      if (prazoResposta)       camposExtras.prazo_resposta       = prazoResposta
      if (valorFixo)           camposExtras.valor_fixo           = valorFixo
      if (percentualExito)     camposExtras.percentual_exito     = percentualExito
      if (formaPagamento)      camposExtras.forma_pagamento      = formaPagamento

      const res = await fetch('/api/ia/gerar-documento', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tipo: tipoModelo,
          clienteId: cliente.id,
          camposExtras: Object.keys(camposExtras).length > 0 ? camposExtras : undefined,
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        toastError('Erro', data.error ?? 'Falha ao gerar documento')
        return
      }
      setDocumentoGerado(data.conteudo)
      setModoEditor(true)
      if (!data.templateExistia) {
        setTemplateExiste(true)
        setTemplateConteudo(data.conteudo)
        success('Gerado com IA e salvo!', 'Próximas gerações serão instantâneas.')
      } else {
        success('Documento gerado!', 'Gerado a partir do modelo salvo.')
      }
    } catch {
      toastError('Erro', 'Falha de rede')
    } finally {
      setGerando(false)
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────

  if (modoEditor && documentoGerado) {
    return (
      <EditorDocumentoPronto
        titulo={tipoNome}
        conteudo={documentoGerado}
        onVoltar={() => setModoEditor(false)}
      />
    )
  }

  return (
    <div className="space-y-6">

      {/* 1. Cliente */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-lg">
            <Users className="h-5 w-5 text-muted-foreground" />
            Cliente
          </CardTitle>
        </CardHeader>
        <CardContent>
          <SeletorCliente
            onSelecionado={(c) => setCliente(c)}
            clienteSelecionado={cliente}
          />
        </CardContent>
      </Card>

      {/* 2. Modelo salvo */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-lg">
            <FileText className="h-5 w-5 text-muted-foreground" />
            Modelo
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {carregandoTemplate ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Verificando modelo salvo...
            </div>
          ) : editandoTemplate ? (
            /* Edição do modelo */
            <div className="space-y-3">
              <p className="text-xs text-muted-foreground">
                Cole ou edite o conteúdo do modelo. Use <code className="rounded bg-muted px-1">{'{{variavel}}'}</code> para campos que mudam por cliente.
              </p>
              <div className="flex items-center gap-2">
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploadando}
                  className="gap-1.5"
                >
                  {uploadando ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
                  {uploadando ? 'Extraindo...' : 'Importar PDF/DOCX'}
                </Button>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".pdf,.docx"
                  className="hidden"
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) handleUpload(f) }}
                />
                <span className="text-xs text-muted-foreground">ou cole o texto abaixo</span>
              </div>
              <Textarea
                value={templateRascunho}
                onChange={(e) => setTemplateRascunho(e.target.value)}
                placeholder="Cole aqui o conteúdo do modelo de documento..."
                rows={10}
              />
              <div className="flex gap-2">
                <Button
                  size="sm"
                  onClick={salvarTemplate}
                  disabled={salvandoTemplate || !templateRascunho.trim()}
                  loading={salvandoTemplate}
                  className="gap-1.5"
                >
                  <Save className="h-3.5 w-3.5" />
                  Salvar modelo
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => { setEditandoTemplate(false); setTemplateRascunho('') }}
                  disabled={salvandoTemplate}
                  className="gap-1.5"
                >
                  <X className="h-3.5 w-3.5" />
                  Cancelar
                </Button>
              </div>
            </div>
          ) : templateExiste ? (
            /* Modelo salvo encontrado */
            <div className="space-y-3">
              <div className="flex items-center justify-between rounded-lg border border-success/20 bg-success/5 px-4 py-3">
                <div className="flex items-center gap-2">
                  <CheckCircle className="h-4 w-4 text-success" />
                  <span className="text-sm font-medium text-success">Modelo salvo — geração instantânea</span>
                </div>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => { setTemplateRascunho(templateConteudo); setEditandoTemplate(true) }}
                    className="flex items-center gap-1 rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-card hover:text-foreground transition-colors"
                    title="Editar modelo"
                  >
                    <Edit3 className="h-3.5 w-3.5" />
                    Editar
                  </button>
                  <button
                    onClick={excluirTemplate}
                    disabled={deletandoTemplate}
                    className="flex items-center gap-1 rounded-md px-2 py-1 text-xs text-destructive hover:bg-destructive/5 hover:text-destructive transition-colors"
                    title="Excluir modelo"
                  >
                    {deletandoTemplate
                      ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      : <Trash2 className="h-3.5 w-3.5" />}
                    Excluir
                  </button>
                </div>
              </div>
            </div>
          ) : (
            /* Sem modelo salvo */
            <div className="space-y-3">
              <div className="flex items-center justify-between rounded-lg border border-amber-200 bg-amber-50 px-4 py-3">
                <div className="flex items-center gap-2">
                  <AlertCircle className="h-4 w-4 text-amber-600" />
                  <span className="text-sm text-amber-800">
                    Nenhum modelo salvo — a IA gerará e salvará automaticamente
                  </span>
                </div>
              </div>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => { setTemplateRascunho(''); setEditandoTemplate(true) }}
                className="gap-1.5"
              >
                <Upload className="h-3.5 w-3.5" />
                Usar meu próprio modelo
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* 3. Campos extras por tipo */}
      {tipoModelo === 'procuracao' && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-lg">
              <FileText className="h-5 w-5 text-muted-foreground" />
              Dados adicionais <span className="text-sm font-normal text-muted-foreground">(opcional)</span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <Input
              label="Finalidade / Objeto da procuração"
              value={objeto}
              onChange={(e) => setObjeto(e.target.value)}
              placeholder="Ex.: Representação judicial e extrajudicial em geral"
            />
          </CardContent>
        </Card>
      )}

      {tipoModelo === 'declaracao_hipossuficiencia' && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-lg">
              <FileText className="h-5 w-5 text-muted-foreground" />
              Dados adicionais <span className="text-sm font-normal text-muted-foreground">(opcional)</span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <Input
              label="Renda mensal aproximada"
              value={rendaMensal}
              onChange={(e) => setRendaMensal(e.target.value)}
              placeholder="Ex.: R$ 1.500,00"
            />
          </CardContent>
        </Card>
      )}

      {tipoModelo === 'substabelecimento' && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-lg">
              <FileText className="h-5 w-5 text-muted-foreground" />
              Dados do substabelecido <span className="text-sm font-normal text-muted-foreground">(opcional)</span>
            </CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-2 gap-4">
            <div className="col-span-2 sm:col-span-1">
              <Input
                label="Nome do advogado substabelecido"
                value={nomeSubstabelecido}
                onChange={(e) => setNomeSubstabelecido(e.target.value)}
                placeholder="Nome completo"
              />
            </div>
            <div className="col-span-2 sm:col-span-1">
              <Input
                label="OAB do substabelecido"
                value={oabSubstabelecido}
                onChange={(e) => setOabSubstabelecido(e.target.value)}
                placeholder="Ex.: 12345/SP"
              />
            </div>
          </CardContent>
        </Card>
      )}

      {tipoModelo === 'notificacao_extrajudicial' && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-lg">
              <FileText className="h-5 w-5 text-muted-foreground" />
              Dados da notificação <span className="text-sm font-normal text-muted-foreground">(opcional)</span>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <Textarea
              label="Objeto da notificação"
              value={objetoNotificacao}
              onChange={(e) => setObjetoNotificacao(e.target.value)}
              placeholder="Descreva o motivo e o que está sendo notificado..."
              rows={3}
            />
            <Input
              label="Prazo para cumprimento (dias)"
              value={prazoResposta}
              onChange={(e) => setPrazoResposta(e.target.value)}
              placeholder="Ex.: 15"
            />
          </CardContent>
        </Card>
      )}

      {tipoModelo === 'contrato_honorarios' && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-lg">
              <FileText className="h-5 w-5 text-muted-foreground" />
              Honorários <span className="text-sm font-normal text-muted-foreground">(opcional)</span>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <Input
                label="Valor fixo (R$)"
                value={valorFixo}
                onChange={(e) => setValorFixo(e.target.value)}
                placeholder="Ex.: 3000"
              />
              <Input
                label="Percentual de êxito (%)"
                value={percentualExito}
                onChange={(e) => setPercentualExito(e.target.value)}
                placeholder="Ex.: 20"
              />
            </div>
            <Select
              label="Forma de pagamento"
              value={formaPagamento}
              onChange={(e) => setFormaPagamento(e.target.value)}
              options={OPCOES_PAGAMENTO}
              placeholder="Selecione..."
            />
          </CardContent>
        </Card>
      )}

      {/* 4. Botão gerar */}
      <div className="flex justify-end">
        <Button
          size="lg"
          onClick={gerar}
          disabled={!cliente || gerando || carregandoTemplate}
          loading={gerando}
          className="gap-2 bg-amber-600 hover:bg-amber-700"
        >
          <Zap className="h-5 w-5" />
          {gerando
            ? 'Gerando...'
            : templateExiste
              ? `Gerar ${tipoNome}`
              : `Gerar com IA`}
        </Button>
      </div>


    </div>
  )
}
