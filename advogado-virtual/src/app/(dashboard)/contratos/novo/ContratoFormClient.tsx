'use client'

import { useState, useCallback, useRef, useEffect } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { useToast } from '@/components/ui/toast'
import { MarkdownPreview } from '@/components/ui/markdown-preview'
import { SeletorCliente } from '@/components/atendimento/SeletorCliente'
import {
  Users, DollarSign, Brain, Loader2, Upload, FileText, ChevronRight,
  FolderOpen, CheckCircle, Sparkles, Link2,
} from 'lucide-react'

const LABELS_AREA_AT: Record<string, string> = {
  previdenciario: 'Previdenciário', trabalhista: 'Trabalhista', civel: 'Cível',
  criminal: 'Criminal', tributario: 'Tributário', empresarial: 'Empresarial',
  familia: 'Família', consumidor: 'Consumidor', imobiliario: 'Imobiliário',
  administrativo: 'Administrativo', geral: 'Análise de Caso',
}

interface AtendimentoOpcao {
  id: string; area: string; tipo_peca_origem: string | null
  status: string; created_at: string
}

const OPCOES_AREA = [
  { value: 'previdenciario', label: 'Previdenciário' },
  { value: 'trabalhista',    label: 'Trabalhista'    },
  { value: 'civel',          label: 'Cível'          },
  { value: 'criminal',       label: 'Criminal'       },
  { value: 'tributario',     label: 'Tributário'     },
  { value: 'empresarial',    label: 'Empresarial'    },
  { value: 'familia',        label: 'Família'        },
  { value: 'consumidor',     label: 'Consumidor'     },
  { value: 'imobiliario',    label: 'Imobiliário'    },
  { value: 'administrativo', label: 'Administrativo' },
]

const OPCOES_FORMA_PAGAMENTO = [
  { value: 'À vista',           label: 'À vista'           },
  { value: 'Mensal',            label: 'Mensal'            },
  { value: 'Na condenação',     label: 'Na condenação'     },
  { value: 'Entrada + parcelas', label: 'Entrada + parcelas' },
  { value: 'Êxito',             label: 'Somente êxito'     },
]

interface TemplateContrato {
  id: string
  titulo: string
  created_at: string
}

interface ContratoFormClientProps {
  role: string
}

export function ContratoFormClient({ role: _role }: ContratoFormClientProps) {
  const { success, error: toastError } = useToast()

  const [cliente,           setCliente]           = useState<{ id: string; nome: string } | null>(null)
  const [atendimentoId,     setAtendimentoId]     = useState<string>('')
  const [atendimentos,      setAtendimentos]      = useState<AtendimentoOpcao[]>([])
  const [carregandoAts,     setCarregandoAts]     = useState(false)
  const [area,              setArea]              = useState('')
  const [valorFixo,         setValorFixo]         = useState('')
  const [percentualExito,   setPercentualExito]   = useState('')
  const [formaPagamento,    setFormaPagamento]    = useState('')
  const [instrucoes,        setInstrucoes]        = useState('')
  const [modeloTexto,       setModeloTexto]       = useState('')
  const [uploadandoModelo,  setUploadandoModelo]  = useState(false)
  const [gerando,           setGerando]           = useState(false)
  const [conteudoGerado,    setConteudoGerado]    = useState('')
  const [contratoId,        setContratoId]        = useState<string | null>(null)

  // ── Repositório de modelos ──
  const [modelosSalvos,       setModelosSalvos]       = useState<TemplateContrato[]>([])
  const [modeloSelecionadoId, setModeloSelecionadoId] = useState<string | null>(null)
  const [carregandoModelos,   setCarregandoModelos]   = useState(false)

  const fileInputRef = useRef<HTMLInputElement>(null)

  // Carregar atendimentos quando cliente é selecionado
  useEffect(() => {
    if (!cliente) { setAtendimentos([]); setAtendimentoId(''); return }
    setCarregandoAts(true)
    fetch(`/api/atendimentos?cliente_id=${cliente.id}`)
      .then(r => r.json())
      .then(d => {
        setAtendimentos(d.atendimentos ?? [])
        setAtendimentoId('')
      })
      .catch(() => {})
      .finally(() => setCarregandoAts(false))
  }, [cliente?.id])

  // Carregar modelos salvos ao montar
  useEffect(() => {
    async function carregar() {
      setCarregandoModelos(true)
      try {
        const res = await fetch('/api/templates-contrato')
        const data = await res.json()
        if (data.templates) {
          setModelosSalvos(data.templates)
          // Selecionar o primeiro automaticamente
          if (data.templates.length > 0) {
            setModeloSelecionadoId(data.templates[0].id)
            // Carregar conteúdo do primeiro modelo
            const resT = await fetch(`/api/templates-contrato/${data.templates[0].id}`)
            const dataT = await resT.json()
            if (dataT.template) setModeloTexto(dataT.template.conteudo_markdown)
          }
        }
      } catch { /* silencioso */ }
      finally { setCarregandoModelos(false) }
    }
    carregar()
  }, [])

  async function selecionarModelo(id: string | null) {
    setModeloSelecionadoId(id)
    if (!id) {
      setModeloTexto('')
      return
    }
    try {
      const res = await fetch(`/api/templates-contrato/${id}`)
      const data = await res.json()
      if (data.template) setModeloTexto(data.template.conteudo_markdown)
    } catch {
      toastError('Erro', 'Falha ao carregar modelo')
    }
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

  const temModeloSelecionado = !!modeloSelecionadoId || !!modeloTexto

  const criarEGerar = useCallback(async () => {
    if (!cliente) {
      toastError('Atenção', 'Selecione um cliente')
      return
    }

    setGerando(true)
    setConteudoGerado('')

    try {
      // 1. Criar contrato
      const resContrato = await fetch('/api/contratos', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          cliente_id:       cliente.id,
          atendimento_id:   atendimentoId || null,
          area:             area || null,
          valor_fixo:       valorFixo ? parseFloat(valorFixo) : null,
          percentual_exito: percentualExito ? parseFloat(percentualExito) : null,
          forma_pagamento:  formaPagamento || null,
        }),
      })
      const dataContrato = await resContrato.json()
      if (!resContrato.ok) {
        toastError('Erro', dataContrato.error ?? 'Não foi possível criar o contrato')
        return
      }
      const id = dataContrato.contrato.id
      setContratoId(id)

      // 2. Gerar contrato (streaming)
      const resIA = await fetch('/api/ia/gerar-contrato', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          contratoId:  id,
          instrucoes:  instrucoes  || undefined,
          modeloTexto: modeloTexto || undefined,
        }),
      })

      if (!resIA.ok || !resIA.body) {
        toastError('Erro na IA', 'Não foi possível gerar o contrato')
        return
      }

      // Stream do conteúdo
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
            const parsed = JSON.parse(line.slice(6))
            if (parsed.type === 'text') {
              conteudo += parsed.text
              setConteudoGerado(conteudo)
            }
          } catch { /* linha parcial */ }
        }
      }

      if (conteudo) {
        // 3. Salvar conteúdo no contrato
        await fetch(`/api/contratos/${id}`, {
          method:  'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({ conteudo_markdown: conteudo }),
        })
        success('Contrato gerado!', temModeloSelecionado ? 'Gerado a partir do seu modelo.' : 'Gerado com IA.')
      }
    } catch (err) {
      console.error('[ContratoForm] Erro:', err)
      toastError('Erro', 'Falha de rede')
    } finally {
      setGerando(false)
    }
  }, [cliente, atendimentoId, area, valorFixo, percentualExito, formaPagamento, instrucoes, modeloTexto, temModeloSelecionado, success, toastError])

  return (
    <div className="space-y-6">

      {/* Cliente */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-lg">
            <Users className="h-5 w-5 text-muted-foreground" />
            Cliente
          </CardTitle>
        </CardHeader>
        <CardContent>
          <SeletorCliente
            onSelecionado={setCliente}
            clienteSelecionado={cliente}
          />
        </CardContent>
      </Card>

      {/* Vincular a atendimento */}
      {cliente && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-lg">
              <Link2 className="h-5 w-5 text-muted-foreground" />
              Vincular a atendimento
              <span className="ml-1 text-xs font-normal text-muted-foreground">(opcional)</span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {carregandoAts ? (
              <div className="flex items-center gap-2 py-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" /> Carregando atendimentos...
              </div>
            ) : atendimentos.length === 0 ? (
              <p className="text-sm text-muted-foreground italic">
                Nenhum atendimento encontrado para este cliente.
              </p>
            ) : (
              <div className="space-y-1.5">
                <button
                  type="button"
                  onClick={() => setAtendimentoId('')}
                  className={`flex w-full items-center gap-3 rounded-lg border px-3 py-2.5 text-left text-sm transition-colors ${
                    !atendimentoId
                      ? 'border-border bg-muted/50 text-muted-foreground'
                      : 'border-border bg-card text-muted-foreground hover:border-border'
                  }`}
                >
                  <span className="flex-1 italic">Sem vínculo (contrato avulso)</span>
                </button>
                {atendimentos.map(at => {
                  const label = [LABELS_AREA_AT[at.area] ?? at.area, at.tipo_peca_origem].filter(Boolean).join(' — ')
                  const data  = new Date(at.created_at).toLocaleDateString('pt-BR')
                  return (
                    <button
                      key={at.id}
                      type="button"
                      onClick={() => setAtendimentoId(at.id)}
                      className={`flex w-full items-center gap-3 rounded-lg border px-3 py-2.5 text-left text-sm transition-colors ${
                        atendimentoId === at.id
                          ? 'border-primary/30 bg-primary/5 text-primary'
                          : 'border-border bg-card text-foreground hover:border-border'
                      }`}
                    >
                      <FileText className={`h-4 w-4 shrink-0 ${atendimentoId === at.id ? 'text-primary' : 'text-muted-foreground'}`} />
                      <span className="flex-1 font-medium">{label}</span>
                      <span className="shrink-0 text-xs text-muted-foreground">{data}</span>
                      {atendimentoId === at.id && <CheckCircle className="h-4 w-4 shrink-0 text-primary" />}
                    </button>
                  )
                })}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Dados do contrato */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-lg">
            <DollarSign className="h-5 w-5 text-muted-foreground" />
            Dados do contrato
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <Select
            label="Área jurídica"
            value={area}
            onChange={e => setArea(e.target.value)}
            options={OPCOES_AREA}
            placeholder="Selecione a área..."
          />
          <div className="grid grid-cols-2 gap-4">
            <Input
              label="Honorários fixos (R$)"
              type="number"
              value={valorFixo}
              onChange={e => setValorFixo(e.target.value)}
              placeholder="Ex.: 3000"
              hint="Deixe em branco se for somente êxito"
            />
            <Input
              label="% sobre o êxito"
              type="number"
              value={percentualExito}
              onChange={e => setPercentualExito(e.target.value)}
              placeholder="Ex.: 20"
              hint="Percentual sobre o valor obtido"
            />
          </div>
          <Select
            label="Forma de pagamento"
            value={formaPagamento}
            onChange={e => setFormaPagamento(e.target.value)}
            options={OPCOES_FORMA_PAGAMENTO}
            placeholder="Selecione..."
          />
        </CardContent>
      </Card>

      {/* Modelo de contrato — Repositório */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-lg">
            <FileText className="h-5 w-5 text-muted-foreground" />
            Modelo de contrato
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {carregandoModelos ? (
            <div className="flex items-center gap-2 py-3 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Carregando modelos...
            </div>
          ) : modelosSalvos.length > 0 ? (
            <div className="space-y-2">
              {/* Lista de modelos existentes */}
              <p className="text-xs font-medium text-muted-foreground">Modelos salvos</p>
              <div className="space-y-1.5 max-h-40 overflow-y-auto">
                {modelosSalvos.map(m => (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => selecionarModelo(m.id === modeloSelecionadoId ? null : m.id)}
                    className={`flex w-full items-center gap-3 rounded-lg border px-3 py-2.5 text-left text-sm transition-colors ${
                      m.id === modeloSelecionadoId
                        ? 'border-primary/30 bg-primary/5 text-primary'
                        : 'border-border bg-card text-foreground hover:border-border'
                    }`}
                  >
                    <FolderOpen className={`h-4 w-4 shrink-0 ${m.id === modeloSelecionadoId ? 'text-primary' : 'text-muted-foreground'}`} />
                    <span className="flex-1 truncate font-medium">{m.titulo}</span>
                    {m.id === modeloSelecionadoId && <CheckCircle className="h-4 w-4 shrink-0 text-primary" />}
                  </button>
                ))}
              </div>

              {/* Opção: gerar sem modelo */}
              <button
                type="button"
                onClick={() => selecionarModelo(null)}
                className={`flex w-full items-center gap-3 rounded-lg border px-3 py-2.5 text-left text-sm transition-colors ${
                  !modeloSelecionadoId && !modeloTexto
                    ? 'border-primary/30 bg-primary/5 text-primary'
                    : 'border-border bg-card text-muted-foreground hover:border-border'
                }`}
              >
                <Sparkles className={`h-4 w-4 shrink-0 ${!modeloSelecionadoId && !modeloTexto ? 'text-primary' : 'text-muted-foreground'}`} />
                <span className="flex-1">Gerar do zero com IA (sem modelo)</span>
              </button>

              {/* Separador */}
              <div className="flex items-center gap-2 pt-1">
                <div className="flex-1 border-t border-border" />
                <span className="text-xs text-muted-foreground">ou enviar novo modelo</span>
                <div className="flex-1 border-t border-border" />
              </div>
            </div>
          ) : (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm text-warning">
              Nenhum modelo salvo. Envie um modelo abaixo ou gere com IA.
            </div>
          )}

          {/* Upload de novo modelo */}
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={uploadandoModelo}
            className="flex w-full items-center justify-center gap-2 rounded-lg border-2 border-dashed border-border bg-muted/50 px-4 py-3 text-sm text-muted-foreground hover:border-primary/30 hover:text-primary transition-colors"
          >
            <Upload className="h-4 w-4" />
            {uploadandoModelo ? 'Extraindo texto e salvando...' : 'Enviar novo modelo PDF/DOCX'}
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".pdf,.docx"
            className="hidden"
            onChange={e => { const f = e.target.files?.[0]; if (f) uploadModelo(f) }}
          />

          {/* Indicador de modelo selecionado */}
          {temModeloSelecionado && !gerando && (
            <div className="flex items-center gap-2 rounded-lg border border-success/20 bg-success/5 px-3 py-2 text-sm text-success">
              <CheckCircle className="h-4 w-4 shrink-0" />
              Modelo selecionado — o contrato seguirá este modelo
            </div>
          )}
        </CardContent>
      </Card>

      {/* Instruções adicionais */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-lg">
            <Brain className="h-5 w-5 text-muted-foreground" />
            Instruções para a IA
            <span className="ml-1 text-xs font-normal text-muted-foreground">(opcional)</span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Textarea
            label="Instruções específicas"
            value={instrucoes}
            onChange={e => setInstrucoes(e.target.value)}
            placeholder="Ex.: Incluir cláusula de mediação obrigatória. Prazo de vigência de 2 anos. Foro de São Paulo."
            rows={3}
          />
        </CardContent>
      </Card>

      {/* Preview do contrato gerado */}
      {conteudoGerado && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-lg">
              {gerando ? 'Gerando contrato...' : 'Contrato gerado'}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="max-h-96 overflow-y-auto rounded-lg border bg-muted/50 p-4">
              <MarkdownPreview>{conteudoGerado}</MarkdownPreview>
              {gerando && <span className="inline-block h-3.5 w-0.5 animate-pulse bg-primary/70 ml-0.5 align-middle" />}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Botões */}
      <div className="flex justify-end gap-3">
        {contratoId && !gerando && (
          <Button
            variant="secondary"
            onClick={() => { window.location.href = `/contratos/${contratoId}` }}
            className="gap-2"
          >
            Abrir editor
            <ChevronRight className="h-4 w-4" />
          </Button>
        )}
        <Button
          size="lg"
          onClick={criarEGerar}
          disabled={!cliente || gerando || uploadandoModelo}
          className="gap-2 min-w-48"
        >
          {gerando ? (
            <><Loader2 className="h-5 w-5 animate-spin" /> Gerando contrato...</>
          ) : temModeloSelecionado ? (
            <><FileText className="h-5 w-5" /> Gerar contrato</>
          ) : (
            <><Brain className="h-5 w-5" /> Gerar com IA</>
          )}
        </Button>
      </div>
    </div>
  )
}
