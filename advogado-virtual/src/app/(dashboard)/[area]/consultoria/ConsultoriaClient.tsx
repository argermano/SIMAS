'use client'

import { useState, useCallback, useEffect } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Dialog } from '@/components/ui/dialog'
import { useToast } from '@/components/ui/toast'
import { SeletorCliente } from '@/components/atendimento/SeletorCliente'
import { GravadorAudio } from '@/components/atendimento/GravadorAudio'
import { MicrofoneInline } from '@/components/atendimento/MicrofoneInline'
import { UploadDocumentos } from '@/components/atendimento/UploadDocumentos'
import { RelatorioAnalise } from '@/components/analise/RelatorioAnalise'
import { getChecklist, TIPOS_PROCESSO, type TipoServico } from '@/lib/constants/checklist-documentos'
import type { ResultadoAnaliseGeral } from '@/app/api/ia/analise-geral/route'
import { useRouter } from 'next/navigation'
import {
  Mic, Keyboard, Users, MessageSquare, Brain, Loader2, UserCheck,
  FileText, AlertTriangle, CheckCircle, Clock, FileCheck, Clipboard,
  Scale, ArrowRight,
} from 'lucide-react'

interface ConsultoriaClientProps {
  area: string
  tiposDocumento: string[]
  tipoConsultoria: string
  atendimentoIdInicial?: string
  clienteIdInicial?: string
}

const TITULOS_CONSULTORIA: Record<string, string> = {
  caso_novo:  'Análise de Caso',
  parecer:    'Parecer Jurídico',
  estrategia: 'Estratégia Processual',
}

const COR_URGENCIA: Record<string, string> = {
  alta:  'border-red-200 bg-red-50 text-red-800',
  media: 'border-amber-200 bg-amber-50 text-amber-800',
  baixa: 'border-green-200 bg-green-50 text-green-800',
}
const ICONE_URGENCIA: Record<string, React.ComponentType<{ className?: string }>> = {
  alta:  AlertTriangle,
  media: Clock,
  baixa: CheckCircle,
}

const OPCOES_FORMA_PAGAMENTO = [
  { value: 'À vista',            label: 'À vista'            },
  { value: 'Mensal',             label: 'Mensal'             },
  { value: 'Na condenação',      label: 'Na condenação'      },
  { value: 'Entrada + parcelas', label: 'Entrada + parcelas' },
  { value: 'Êxito',              label: 'Somente êxito'      },
]

export function ConsultoriaClient({
  area,
  tiposDocumento,
  tipoConsultoria,
  atendimentoIdInicial,
  clienteIdInicial,
}: ConsultoriaClientProps) {
  const router = useRouter()
  const { success, error: toastError } = useToast()

  const isContinuacao = !!atendimentoIdInicial

  // Estados comuns
  const [atendimentoId, setAtendimentoId] = useState<string | null>(atendimentoIdInicial ?? null)
  const [cliente, setCliente]             = useState<{ id: string; nome: string } | null>(null)
  const [modoInput, setModoInput]         = useState<'durante_reuniao' | 'pos_reuniao' | 'texto'>('durante_reuniao')
  const [textoRelato, setTextoRelato]     = useState('')
  const [transcricao, setTranscricao]     = useState('')
  const [pedidoEspecifico, setPedidoEspecifico] = useState('')
  const [analisando, setAnalisando]       = useState(false)
  const [analise, setAnalise]             = useState<Record<string, unknown> | null>(null)
  const [carregando, setCarregando]       = useState(!!atendimentoIdInicial)

  // Estados exclusivos do modo continuação
  const [analiseGeral, setAnaliseGeral]   = useState<ResultadoAnaliseGeral | null>(null)
  const [documentosExistentes, setDocumentosExistentes] = useState<Array<{ tipo: string; file_name: string }>>([])
  const [tipoServico, setTipoServico]     = useState<TipoServico | null>(null)
  const [tipoProcesso, setTipoProcesso]   = useState('')
  const [salvandoTipo, setSalvandoTipo]   = useState(false)

  // Estados dos dialogs
  const [showModalContrato, setShowModalContrato]         = useState(false)
  const [showModalDocs, setShowModalDocs]                 = useState(false)
  const [showModalGerarPeca, setShowModalGerarPeca]       = useState(false)
  // Modal contrato
  const [tipoValor, setTipoValor]         = useState<'fixo' | 'exito'>('fixo')
  const [valorFixo, setValorFixo]         = useState('')
  const [percentualExito, setPercentualExito] = useState('')
  const [formaPagamento, setFormaPagamento]   = useState('')
  const [gerandoContrato, setGerandoContrato] = useState(false)
  // Modal tipo serviço (gerar peça)
  const [tipoServicoModal, setTipoServicoModal] = useState<TipoServico>('judicial')
  const [tipoProcessoModal, setTipoProcessoModal] = useState('')
  const [salvandoGerarPeca, setSalvandoGerarPeca] = useState(false)

  const tituloConsultoria = TITULOS_CONSULTORIA[tipoConsultoria] ?? 'Análise de Caso'

  // ── Carregar atendimento existente ────────────────────────────────────────
  useEffect(() => {
    if (!atendimentoIdInicial) return

    async function carregar() {
      try {
        const res = await fetch(`/api/atendimentos/${atendimentoIdInicial}`)
        if (!res.ok) return
        const data = await res.json()
        const at = data.atendimento
        if (!at) return

        if (at.cliente_id && at.clientes) {
          setCliente({ id: at.cliente_id, nome: at.clientes.nome ?? 'Cliente' })
        }
        const modoSalvo = at.modo_input
        setModoInput(modoSalvo === 'texto' ? 'texto' : modoSalvo === 'pos_reuniao' ? 'pos_reuniao' : 'durante_reuniao')
        setTextoRelato(at.transcricao_editada ?? at.transcricao_raw ?? '')
        setTranscricao(at.transcricao_editada ?? at.transcricao_raw ?? '')
        setPedidoEspecifico(at.pedidos_especificos ?? '')
        setTipoServico(at.tipo_servico ?? null)
        setTipoProcesso(at.tipo_processo ?? '')
        setDocumentosExistentes(at.documentos ?? [])

        // Carregar diagnóstico salvo
        const analises = at.analises as Array<{ id: string; plano_a: ResultadoAnaliseGeral }> | undefined
        if (analises && analises.length > 0 && analises[0].plano_a) {
          setAnaliseGeral(analises[0].plano_a)
        }
      } catch {
        toastError('Erro', 'Não foi possível carregar o atendimento')
      } finally {
        setCarregando(false)
      }
    }
    carregar()
  }, [atendimentoIdInicial, toastError])

  // ── Handlers modo normal ──────────────────────────────────────────────────
  const handleClienteSelecionado = useCallback(async (c: { id: string; nome: string } | null) => {
    if (!c) {
      setCliente(null)
      if (!atendimentoIdInicial) setAtendimentoId(null)
      return
    }
    setCliente(c)
    if (!atendimentoId) {
      try {
        const res = await fetch('/api/atendimentos', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            cliente_id: c.id,
            area,
            modo_input: modoInput === 'texto' ? 'texto' : 'audio',
          }),
        })
        const data = await res.json()
        if (data.id) {
          setAtendimentoId(data.id)
        } else {
          toastError('Erro', data.error ?? 'Não foi possível criar o atendimento')
        }
      } catch {
        toastError('Erro', 'Falha de rede ao criar atendimento')
      }
    }
  }, [atendimentoId, atendimentoIdInicial, area, modoInput, toastError])

  // Pré-selecionar cliente quando vindo da página do cliente (clienteIdInicial)
  useEffect(() => {
    if (!clienteIdInicial || atendimentoIdInicial) return

    fetch(`/api/clientes/${clienteIdInicial}`)
      .then(r => r.json())
      .then(data => {
        const c = data.cliente
        if (c?.id && c?.nome) {
          handleClienteSelecionado({ id: c.id, nome: c.nome })
        }
      })
      .catch(() => { /* silencioso */ })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []) // executa só no mount; clienteIdInicial e atendimentoIdInicial são props estáveis

  const handleTranscricao = useCallback((texto: string) => {
    setTranscricao(texto)
    setTextoRelato(texto)
    success('Áudio transcrito', 'Revise o texto e clique em Analisar')
  }, [success])

  async function analisar() {
    if (!atendimentoId) return

    await fetch(`/api/atendimentos/${atendimentoId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        transcricao_editada: textoRelato,
        pedidos_especificos: pedidoEspecifico,
        modo_input: modoInput === 'texto' ? 'texto' : 'audio',
      }),
    })

    setAnalisando(true)
    setAnalise(null)
    try {
      const res = await fetch('/api/ia/analise', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ atendimentoId }),
      })
      const data = await res.json()
      if (res.ok) {
        setAnalise(data)
        success('Análise concluída', 'Veja o relatório abaixo')
      } else {
        toastError('Erro', data.error ?? 'Falha ao gerar análise')
      }
    } catch {
      toastError('Erro', 'Falha de rede')
    } finally {
      setAnalisando(false)
    }
  }

  function handleGerarPecaRelatorio(tipoPeca: string) {
    if (!atendimentoId) return
    router.push(`/${area}/pecas/${tipoPeca}?id=${atendimentoId}`)
  }

  // ── Handlers modo continuação ─────────────────────────────────────────────
  async function salvarTipoServico(ts: TipoServico, tp?: string) {
    if (!atendimentoId) return
    setSalvandoTipo(true)
    try {
      await fetch(`/api/atendimentos/${atendimentoId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tipo_servico:  ts,
          tipo_processo: ts === 'judicial' ? (tp ?? tipoProcesso) : null,
        }),
      })
      setTipoServico(ts)
      if (ts === 'judicial' && tp !== undefined) setTipoProcesso(tp)
      if (ts === 'administrativo') setTipoProcesso('')
    } catch { /* silencioso */ }
    finally { setSalvandoTipo(false) }
  }

  async function emitirContrato() {
    if (!cliente || !atendimentoId) return
    setGerandoContrato(true)
    try {
      // 1. Criar contrato
      const resC = await fetch('/api/contratos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          cliente_id:       cliente.id,
          atendimento_id:   atendimentoId,
          area,
          valor_fixo:       tipoValor === 'fixo' && valorFixo ? parseFloat(valorFixo) : null,
          percentual_exito: tipoValor === 'exito' && percentualExito ? parseFloat(percentualExito) : null,
          forma_pagamento:  formaPagamento || null,
        }),
      })
      const dataC = await resC.json()
      if (!resC.ok) {
        toastError('Erro', dataC.error ?? 'Não foi possível criar o contrato')
        return
      }
      const contratoId = dataC.contrato.id

      // 2. Gerar com IA (streaming — aguardar conclusão)
      const resIA = await fetch('/api/ia/gerar-contrato', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contratoId }),
      })
      if (resIA.ok && resIA.body) {
        const reader  = resIA.body.getReader()
        while (true) {
          const { done } = await reader.read()
          if (done) break
        }
      }

      setShowModalContrato(false)
      success('Contrato gerado!', 'Redirecionando para o editor...')
      router.push(`/contratos/${contratoId}`)
    } catch {
      toastError('Erro', 'Falha ao gerar contrato')
    } finally {
      setGerandoContrato(false)
    }
  }

  async function confirmarEGerarPeca() {
    if (!atendimentoId) return
    setSalvandoGerarPeca(true)
    try {
      await fetch(`/api/atendimentos/${atendimentoId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tipo_servico:  tipoServicoModal,
          tipo_processo: tipoServicoModal === 'judicial' ? tipoProcessoModal : null,
        }),
      })
      setShowModalGerarPeca(false)
      router.push(`/${area}/pecas/peticao_inicial?id=${atendimentoId}`)
    } catch {
      toastError('Erro', 'Falha ao salvar tipo de serviço')
    } finally {
      setSalvandoGerarPeca(false)
    }
  }

  function handleGerarPecaContinuacao() {
    if (!atendimentoId) return
    if (area === 'previdenciario' && !tipoServico) {
      setShowModalGerarPeca(true)
      return
    }
    router.push(`/${area}/pecas/peticao_inicial?id=${atendimentoId}`)
  }

  function copiarDocsFaltantes(lista: string[]) {
    const texto = lista.join('\n')
    navigator.clipboard.writeText(texto).then(() => {
      success('Copiado!', 'Lista copiada para a área de transferência')
    })
  }

  const podeAnalisar = !!atendimentoId && (textoRelato.trim().length > 0 || transcricao.trim().length > 0)

  // ── Calcular docs faltantes ───────────────────────────────────────────────
  const checklistFaltante = (() => {
    if (!isContinuacao) return []
    const checklist = getChecklist(area, tipoServico ?? 'administrativo', tipoProcesso || undefined)
    return checklist.filter(item => !documentosExistentes.some(d => d.tipo === item.id))
  })()

  // ── Loading ───────────────────────────────────────────────────────────────
  if (carregando) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="text-center space-y-3">
          <div className="mx-auto h-8 w-8 animate-spin rounded-full border-4 border-primary-200 border-t-primary-800" />
          <p className="text-sm text-gray-500">Carregando atendimento...</p>
        </div>
      </div>
    )
  }

  // ══════════════════════════════════════════════════════════════════════════
  // MODO CONTINUAÇÃO (vindo de Análise de Caso)
  // ══════════════════════════════════════════════════════════════════════════
  if (isContinuacao) {
    const tiposProcessoArea = TIPOS_PROCESSO[area] ?? []
    const mostraCardTipoServico = area === 'previdenciario' || area === 'trabalhista'

    return (
      <div className="space-y-6">

        {/* 1. Informações do Atendimento */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-lg">
              <Users className="h-5 w-5 text-gray-400" />
              Informações do Atendimento
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {cliente && (
              <div className="inline-flex items-center gap-2 rounded-full bg-green-100 px-3 py-1.5 text-sm font-medium text-green-800">
                <CheckCircle className="h-4 w-4" />
                {cliente.nome}
              </div>
            )}
            {textoRelato && (
              <div>
                <p className="mb-1 text-xs font-medium text-gray-500 uppercase tracking-wide">Relato</p>
                <p className="text-sm text-gray-700 leading-relaxed line-clamp-4">{textoRelato}</p>
              </div>
            )}
            {pedidoEspecifico && (
              <div>
                <p className="mb-1 text-xs font-medium text-gray-500 uppercase tracking-wide">Questão específica</p>
                <p className="text-sm text-gray-700">{pedidoEspecifico}</p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* 2. Diagnóstico da IA */}
        {analiseGeral && (
          <Card className="border-violet-200">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-lg">
                <Brain className="h-5 w-5 text-violet-600" />
                Diagnóstico da IA
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Urgência */}
              {analiseGeral.urgencia && (
                <div className={`flex items-start gap-3 rounded-xl border px-4 py-3 ${COR_URGENCIA[analiseGeral.urgencia] ?? COR_URGENCIA.media}`}>
                  {(() => {
                    const Icone = ICONE_URGENCIA[analiseGeral.urgencia] ?? Clock
                    return <Icone className="mt-0.5 h-4 w-4 shrink-0" />
                  })()}
                  <div>
                    <p className="font-semibold capitalize text-sm">
                      Urgência {analiseGeral.urgencia}
                      {analiseGeral.classificacao_provavel && ` — ${analiseGeral.classificacao_provavel}`}
                    </p>
                    <p className="mt-0.5 text-xs">{analiseGeral.justificativa_urgencia}</p>
                  </div>
                </div>
              )}

              {/* Resumo */}
              <p className="text-sm text-gray-700 leading-relaxed">{analiseGeral.resumo_caso}</p>

              {/* Áreas */}
              {analiseGeral.areas_identificadas?.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {analiseGeral.areas_identificadas.map(a => (
                    <span
                      key={a.area}
                      className={`rounded-full px-3 py-1 text-xs font-medium ${
                        a.relevancia === 'principal'
                          ? 'bg-primary-100 text-primary-800'
                          : 'bg-gray-100 text-gray-600'
                      }`}
                    >
                      {a.nome}
                    </span>
                  ))}
                </div>
              )}

              {/* Recomendação */}
              {analiseGeral.recomendacao_imediata && (
                <div className="rounded-lg bg-violet-50 border border-violet-100 px-3 py-2.5">
                  <p className="text-xs font-semibold text-violet-700 mb-1">Recomendação imediata</p>
                  <p className="text-sm text-violet-900">{analiseGeral.recomendacao_imediata}</p>
                </div>
              )}

              {/* Documentos a solicitar (referência) */}
              {analiseGeral.documentos_solicitar?.length > 0 && (
                <div>
                  <p className="text-xs font-semibold text-gray-500 mb-1.5">Documentos identificados</p>
                  <ul className="space-y-1">
                    {analiseGeral.documentos_solicitar.map((doc, i) => (
                      <li key={i} className="flex items-start gap-2 text-xs text-gray-600">
                        <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-gray-400" />
                        {doc}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* 3. Documentos */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-lg">
              <FileText className="h-5 w-5 text-gray-400" />
              Documentos
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {documentosExistentes.length > 0 && (
              <div className="space-y-1.5">
                <p className="text-xs font-medium text-gray-500">Já anexados:</p>
                <ul className="space-y-1">
                  {documentosExistentes.map((doc, i) => (
                    <li key={i} className="flex items-center gap-2 text-sm text-gray-700">
                      <FileCheck className="h-4 w-4 shrink-0 text-green-500" />
                      {doc.file_name}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <UploadDocumentos
              atendimentoId={atendimentoId}
              tiposDocumento={tiposDocumento}
            />
          </CardContent>
        </Card>

        {/* 4. Tipo de Serviço (previdenciário / trabalhista) */}
        {mostraCardTipoServico && (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-lg">
                <Scale className="h-5 w-5 text-gray-400" />
                Tipo de Serviço
                {salvandoTipo && <Loader2 className="h-4 w-4 animate-spin text-gray-400" />}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex gap-3">
                <button
                  onClick={() => salvarTipoServico('administrativo')}
                  className={`flex-1 rounded-lg border-2 px-4 py-3 text-sm font-medium transition-colors ${
                    tipoServico === 'administrativo'
                      ? 'border-primary-600 bg-primary-50 text-primary-800'
                      : 'border-gray-200 text-gray-600 hover:border-gray-300'
                  }`}
                >
                  Administrativo
                </button>
                <button
                  onClick={() => salvarTipoServico('judicial')}
                  className={`flex-1 rounded-lg border-2 px-4 py-3 text-sm font-medium transition-colors ${
                    tipoServico === 'judicial'
                      ? 'border-primary-600 bg-primary-50 text-primary-800'
                      : 'border-gray-200 text-gray-600 hover:border-gray-300'
                  }`}
                >
                  Judicial
                </button>
              </div>

              {tipoServico === 'judicial' && tiposProcessoArea.length > 0 && (
                <Select
                  label="Tipo de processo"
                  value={tipoProcesso}
                  onChange={(e) => {
                    setTipoProcesso(e.target.value)
                    salvarTipoServico('judicial', e.target.value)
                  }}
                  options={tiposProcessoArea}
                  placeholder="Selecione o tipo..."
                />
              )}
            </CardContent>
          </Card>
        )}

        {/* 5. Barra de ações */}
        <div className="flex flex-wrap items-center justify-end gap-3 pb-4">
          <Button
            variant="secondary"
            size="md"
            onClick={() => setShowModalDocs(true)}
            className="gap-2"
          >
            <Clipboard className="h-4 w-4" />
            Docs Faltantes
          </Button>
          <Button
            variant="secondary"
            size="md"
            onClick={() => setShowModalContrato(true)}
            disabled={!cliente}
            className="gap-2"
          >
            <FileText className="h-4 w-4" />
            Emitir Contrato
          </Button>
          <Button
            size="md"
            onClick={handleGerarPecaContinuacao}
            disabled={!atendimentoId}
            className="gap-2 bg-primary-700 hover:bg-primary-800"
          >
            Gerar Peça com IA
            <ArrowRight className="h-4 w-4" />
          </Button>
        </div>

        {/* ── Dialog A: Emitir Contrato de Honorários ── */}
        <Dialog
          open={showModalContrato}
          onClose={() => setShowModalContrato(false)}
          title="Emitir Contrato de Honorários"
          description={cliente ? `Cliente: ${cliente.nome} · Área: ${area}` : undefined}
          size="md"
          footer={
            <>
              <Button variant="secondary" size="md" onClick={() => setShowModalContrato(false)} disabled={gerandoContrato}>
                Cancelar
              </Button>
              <Button
                size="md"
                onClick={emitirContrato}
                loading={gerandoContrato}
                disabled={gerandoContrato}
                className="gap-2 bg-primary-700 hover:bg-primary-800"
              >
                {gerandoContrato ? 'Gerando...' : 'Gerar com IA'}
              </Button>
            </>
          }
        >
          <div className="space-y-4">
            {/* Toggle tipo de valor */}
            <div className="flex rounded-lg border bg-gray-50 p-1 gap-1">
              <button
                onClick={() => setTipoValor('fixo')}
                className={`flex-1 rounded-md px-3 py-2 text-sm font-medium transition-colors ${
                  tipoValor === 'fixo' ? 'bg-white shadow-sm text-gray-900' : 'text-gray-500 hover:text-gray-700'
                }`}
              >
                Valor fixo (R$)
              </button>
              <button
                onClick={() => setTipoValor('exito')}
                className={`flex-1 rounded-md px-3 py-2 text-sm font-medium transition-colors ${
                  tipoValor === 'exito' ? 'bg-white shadow-sm text-gray-900' : 'text-gray-500 hover:text-gray-700'
                }`}
              >
                % de êxito
              </button>
            </div>

            {tipoValor === 'fixo' ? (
              <Input
                label="Valor fixo (R$)"
                type="number"
                min="0"
                step="0.01"
                value={valorFixo}
                onChange={(e) => setValorFixo(e.target.value)}
                placeholder="Ex.: 3000.00"
              />
            ) : (
              <Input
                label="Percentual de êxito (%)"
                type="number"
                min="0"
                max="100"
                step="0.5"
                value={percentualExito}
                onChange={(e) => setPercentualExito(e.target.value)}
                placeholder="Ex.: 30"
              />
            )}

            <Select
              label="Forma de pagamento"
              value={formaPagamento}
              onChange={(e) => setFormaPagamento(e.target.value)}
              options={OPCOES_FORMA_PAGAMENTO}
              placeholder="Selecione..."
            />
          </div>
        </Dialog>

        {/* ── Dialog B: Documentos Faltantes ── */}
        <Dialog
          open={showModalDocs}
          onClose={() => setShowModalDocs(false)}
          title="Documentos Faltantes"
          description={`${area === 'previdenciario' ? 'Previdenciário' : 'Trabalhista'} — ${tipoServico === 'judicial' ? `Judicial${tipoProcesso ? ` / ${tipoProcesso}` : ''}` : 'Administrativo'}`}
          size="md"
          footer={
            <>
              <Button variant="secondary" size="md" onClick={() => setShowModalDocs(false)}>
                Fechar
              </Button>
              {checklistFaltante.length > 0 && (
                <Button
                  size="md"
                  onClick={() => copiarDocsFaltantes(checklistFaltante.map(i => `• ${i.nome}`))}
                  className="gap-2"
                >
                  <Clipboard className="h-4 w-4" />
                  Copiar lista
                </Button>
              )}
            </>
          }
        >
          {!tipoServico && (
            <p className="mb-3 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
              Tipo de serviço não definido. Exibindo lista para <strong>Administrativo</strong>.
            </p>
          )}
          {checklistFaltante.length === 0 ? (
            <div className="py-6 text-center">
              <CheckCircle className="mx-auto h-10 w-10 text-green-500 mb-2" />
              <p className="text-sm font-medium text-gray-700">Todos os documentos foram anexados!</p>
            </div>
          ) : (
            <ul className="space-y-2">
              {checklistFaltante.map((item) => (
                <li key={item.id} className="flex items-start gap-3 rounded-lg border border-amber-100 bg-amber-50 px-3 py-2.5">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
                  <div>
                    <p className="text-sm font-medium text-gray-800">{item.nome}</p>
                    {item.obrigatorio && (
                      <span className="text-xs text-amber-600">Obrigatório</span>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Dialog>

        {/* ── Dialog C: Tipo de Serviço para gerar peça (previdenciário) ── */}
        <Dialog
          open={showModalGerarPeca}
          onClose={() => setShowModalGerarPeca(false)}
          title="Selecionar Tipo de Serviço"
          description="Antes de gerar a peça, informe se é um caso administrativo ou judicial."
          size="sm"
          footer={
            <>
              <Button variant="secondary" size="md" onClick={() => setShowModalGerarPeca(false)} disabled={salvandoGerarPeca}>
                Cancelar
              </Button>
              <Button
                size="md"
                onClick={confirmarEGerarPeca}
                loading={salvandoGerarPeca}
                disabled={salvandoGerarPeca || (tipoServicoModal === 'judicial' && !tipoProcessoModal)}
                className="gap-2"
              >
                {salvandoGerarPeca ? 'Aguarde...' : 'Confirmar e Gerar'}
              </Button>
            </>
          }
        >
          <div className="space-y-4">
            <div className="flex gap-3">
              <button
                onClick={() => setTipoServicoModal('administrativo')}
                className={`flex-1 rounded-lg border-2 px-4 py-3 text-sm font-medium transition-colors ${
                  tipoServicoModal === 'administrativo'
                    ? 'border-primary-600 bg-primary-50 text-primary-800'
                    : 'border-gray-200 text-gray-600 hover:border-gray-300'
                }`}
              >
                Administrativo
              </button>
              <button
                onClick={() => setTipoServicoModal('judicial')}
                className={`flex-1 rounded-lg border-2 px-4 py-3 text-sm font-medium transition-colors ${
                  tipoServicoModal === 'judicial'
                    ? 'border-primary-600 bg-primary-50 text-primary-800'
                    : 'border-gray-200 text-gray-600 hover:border-gray-300'
                }`}
              >
                Judicial
              </button>
            </div>
            {tipoServicoModal === 'judicial' && (TIPOS_PROCESSO[area] ?? []).length > 0 && (
              <Select
                label="Tipo de processo"
                value={tipoProcessoModal}
                onChange={(e) => setTipoProcessoModal(e.target.value)}
                options={TIPOS_PROCESSO[area] ?? []}
                placeholder="Selecione o tipo..."
              />
            )}
          </div>
        </Dialog>
      </div>
    )
  }

  // ══════════════════════════════════════════════════════════════════════════
  // MODO NORMAL (novo atendimento)
  // ══════════════════════════════════════════════════════════════════════════
  return (
    <div className="space-y-6">

      {/* 1. Seleção de Cliente */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-lg">
            <Users className="h-5 w-5 text-gray-400" />
            Cliente
          </CardTitle>
        </CardHeader>
        <CardContent>
          <SeletorCliente
            onSelecionado={handleClienteSelecionado}
            clienteSelecionado={cliente}
          />
        </CardContent>
      </Card>

      {/* 2. Relato do Caso */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-lg">
            <MessageSquare className="h-5 w-5 text-gray-400" />
            Relato de Caso | Atendimento Cliente
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Tabs: 3 modos de entrada */}
          <div className="flex rounded-lg border bg-gray-50 p-1 gap-1">
            <button
              onClick={() => setModoInput('durante_reuniao')}
              className={`flex flex-1 items-center justify-center gap-2 rounded-md px-3 py-2.5 text-sm font-medium transition-colors ${
                modoInput === 'durante_reuniao'
                  ? 'bg-white text-primary-800 shadow-sm'
                  : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              <UserCheck className="h-4 w-4" />
              Gravar com cliente
            </button>
            <button
              onClick={() => setModoInput('pos_reuniao')}
              className={`flex flex-1 items-center justify-center gap-2 rounded-md px-3 py-2.5 text-sm font-medium transition-colors ${
                modoInput === 'pos_reuniao'
                  ? 'bg-white text-primary-800 shadow-sm'
                  : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              <Mic className="h-4 w-4" />
              Relato pós-reunião
            </button>
            <button
              onClick={() => setModoInput('texto')}
              className={`flex flex-1 items-center justify-center gap-2 rounded-md px-3 py-2.5 text-sm font-medium transition-colors ${
                modoInput === 'texto'
                  ? 'bg-white text-primary-800 shadow-sm'
                  : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              <Keyboard className="h-4 w-4" />
              Digitar
            </button>
          </div>

          {modoInput === 'durante_reuniao' && (
            <div className="space-y-4">
              <p className="text-xs text-gray-500">
                Grave o áudio <strong>com o cliente presente</strong>. O consentimento LGPD será solicitado antes de iniciar.
              </p>
              <GravadorAudio
                onTranscricao={handleTranscricao}
                atendimentoId={atendimentoId}
                disabled={!atendimentoId}
                requerConsentimento={true}
              />
              {transcricao && (
                <Textarea
                  label="Transcrição (edite se necessário)"
                  value={textoRelato}
                  onChange={(e) => setTextoRelato(e.target.value)}
                  rows={8}
                />
              )}
            </div>
          )}

          {modoInput === 'pos_reuniao' && (
            <div className="space-y-4">
              <p className="text-xs text-gray-500">
                Relate os fatos com <strong>suas próprias palavras</strong> após a reunião. Sem necessidade de consentimento LGPD.
              </p>
              <GravadorAudio
                onTranscricao={handleTranscricao}
                atendimentoId={atendimentoId}
                disabled={!atendimentoId}
                requerConsentimento={false}
              />
              {transcricao && (
                <Textarea
                  label="Transcrição (edite se necessário)"
                  value={textoRelato}
                  onChange={(e) => setTextoRelato(e.target.value)}
                  rows={8}
                />
              )}
            </div>
          )}

          {modoInput === 'texto' && (
            <Textarea
              label="Descreva o caso"
              value={textoRelato}
              onChange={(e) => setTextoRelato(e.target.value)}
              placeholder="Descreva os fatos e a situação atual do cliente..."
              hint="Quanto mais detalhes, mais precisa será a análise"
              rows={8}
              disabled={!atendimentoId}
            />
          )}
        </CardContent>
      </Card>

      {/* 3. Pedido / Questão específica */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-lg">
            <Brain className="h-5 w-5 text-gray-400" />
            Questão específica (opcional)
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <Textarea
            label="O que você quer que a IA analise especificamente?"
            value={pedidoEspecifico}
            onChange={(e) => setPedidoEspecifico(e.target.value)}
            placeholder="Ex.: Qual a melhor estratégia para reconhecimento de atividade especial?"
            rows={3}
            disabled={!atendimentoId}
          />
          {atendimentoId && (
            <div className="flex items-center gap-2">
              <span className="text-xs text-gray-400">Ou dite:</span>
              <MicrofoneInline
                onTranscricao={(t) => setPedidoEspecifico(prev => prev ? prev + ' ' + t : t)}
              />
            </div>
          )}
        </CardContent>
      </Card>

      {/* 4. Documentos */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-lg">
            <FileText className="h-5 w-5 text-gray-400" />
            Documentos
          </CardTitle>
        </CardHeader>
        <CardContent>
          <UploadDocumentos
            atendimentoId={atendimentoId}
            tiposDocumento={tiposDocumento}
            disabled={!atendimentoId}
          />
        </CardContent>
      </Card>

      {/* 5. Botão Analisar */}
      <div className="flex justify-end gap-3 pb-4">
        <Button
          variant="secondary"
          size="lg"
          onClick={() => router.push(`/${area}`)}
          disabled={analisando}
        >
          Cancelar
        </Button>
        <Button
          size="lg"
          onClick={analisar}
          disabled={!podeAnalisar || analisando}
          className="gap-2 bg-violet-700 hover:bg-violet-800 min-w-44"
        >
          {analisando ? (
            <>
              <Loader2 className="h-5 w-5 animate-spin" />
              Analisando... (pode levar 30s)
            </>
          ) : (
            <>
              <Brain className="h-5 w-5" />
              {tituloConsultoria}
            </>
          )}
        </Button>
      </div>

      {/* 6. Relatório da análise */}
      {analise && (
        <div className="space-y-2">
          <h2 className="text-lg font-semibold text-gray-900">{tituloConsultoria} — Resultado</h2>
          <RelatorioAnalise data={analise as Parameters<typeof RelatorioAnalise>[0]['data']} onGerarPeca={handleGerarPecaRelatorio} />
        </div>
      )}
    </div>
  )
}
