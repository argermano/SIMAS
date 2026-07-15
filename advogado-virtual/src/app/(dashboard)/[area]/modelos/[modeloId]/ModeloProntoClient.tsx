'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { useToast } from '@/components/ui/toast'
import { SeletorCliente } from '@/components/atendimento/SeletorCliente'
import { EditorDocumentoPronto } from '@/components/documentos/EditorDocumentoPronto'
import { TIPOS_COM_MODELO_DOCX } from '@/lib/export/tipos-modelo-docx'
import { Users, FileText, CheckCircle, AlertCircle, Loader2, Zap } from 'lucide-react'
import { formatarMoedaInput } from '@/lib/utils'

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

interface ModeloProntoClientProps {
  tipo: string
  tipoNome: string
  clienteIdInicial?: string
  atendimentoId?: string
}

// ── Componente ────────────────────────────────────────────────────────────────

export function ModeloProntoClient({ tipo, tipoNome, clienteIdInicial, atendimentoId }: ModeloProntoClientProps) {
  const tipoModelo = tipo as TipoModelo
  const router = useRouter()
  const { success, error: toastError } = useToast()

  const [cliente, setCliente] = useState<{ id: string; nome: string } | null>(null)

  // Modelo .docx do escritório (fonte única) — preenche preservando a formatação
  const suportaModelo = TIPOS_COM_MODELO_DOCX.includes(tipoModelo)
  const [modeloDocxExiste, setModeloDocxExiste] = useState(false)
  const [carregandoModelo, setCarregandoModelo] = useState(true)

  // Geração
  const [gerando, setGerando]                 = useState(false)
  const [documentoGerado, setDocumentoGerado] = useState('')
  const [modoEditor, setModoEditor]           = useState(false)
  const [baixandoModelo, setBaixandoModelo]   = useState(false)
  const [salvandoCaso, setSalvandoCaso]       = useState(false)
  // Id do documento já anexado ao caso — em re-saves, atualiza o mesmo (não duplica)
  const [documentoIdSalvo, setDocumentoIdSalvo] = useState<string | null>(null)

  // Campos extras por tipo
  const [objeto, setObjeto]                         = useState('')
  const [rendaMensal, setRendaMensal]               = useState('')
  const [numeroDependentes, setNumeroDependentes]   = useState('')
  const [nomeSubstabelecido, setNomeSubstabelecido] = useState('')
  const [oabSubstabelecido, setOabSubstabelecido]   = useState('')
  const [objetoNotificacao, setObjetoNotificacao]   = useState('')
  const [prazoResposta, setPrazoResposta]           = useState('15')
  const [valorFixo, setValorFixo]                   = useState('')
  const [percentualExito, setPercentualExito]       = useState('')
  const [formaPagamento, setFormaPagamento]         = useState('')

  // Verifica se há modelo .docx do escritório cadastrado para este tipo
  useEffect(() => {
    if (!suportaModelo) { setCarregandoModelo(false); setModeloDocxExiste(false); return }
    let ativo = true
    fetch(`/api/documentos/exportar-modelo?tipo=${tipoModelo}`)
      .then((r) => r.json())
      .then((d) => { if (ativo) setModeloDocxExiste(!!d.existe) })
      .catch(() => { /* silencioso */ })
      .finally(() => { if (ativo) setCarregandoModelo(false) })
    return () => { ativo = false }
  }, [suportaModelo, tipoModelo])

  // Pré-selecionar cliente quando vindo via searchParam
  useEffect(() => {
    if (!clienteIdInicial) return
    fetch(`/api/clientes/${clienteIdInicial}`)
      .then((r) => r.json())
      .then((data) => {
        const c = data.cliente
        if (c?.id && c?.nome) setCliente({ id: c.id, nome: c.nome })
      })
      .catch(() => { /* silencioso */ })
  }, [clienteIdInicial])

  function montarCamposExtras(): Record<string, string> {
    const campos: Record<string, string> = {}
    if (objeto)              campos.objeto               = objeto
    if (rendaMensal)         campos.renda_mensal         = rendaMensal
    if (numeroDependentes)   campos.numero_dependentes   = numeroDependentes
    if (nomeSubstabelecido)  campos.nome_substabelecido  = nomeSubstabelecido
    if (oabSubstabelecido)   campos.oab_substabelecido   = oabSubstabelecido
    if (objetoNotificacao)   campos.objeto_notificacao   = objetoNotificacao
    if (prazoResposta)       campos.prazo_resposta       = prazoResposta
    if (valorFixo)           campos.valor_fixo           = valorFixo
    if (percentualExito)     campos.percentual_exito     = percentualExito
    if (formaPagamento)      campos.forma_pagamento      = formaPagamento
    return campos
  }

  // Gerar → abre o editor para revisão (não baixa nada automaticamente)
  async function gerar() {
    if (!cliente) {
      toastError('Atenção', 'Selecione um cliente para gerar o documento')
      return
    }
    setGerando(true)
    setDocumentoGerado('')
    try {
      const camposExtras = montarCamposExtras()
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
    } catch {
      toastError('Erro', 'Falha de rede')
    } finally {
      setGerando(false)
    }
  }

  // Baixa no modelo .docx do escritório (formatação exata) — ação do editor
  async function baixarModelo() {
    if (!cliente) return
    setBaixandoModelo(true)
    try {
      const res = await fetch('/api/documentos/exportar-modelo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tipo: tipoModelo, clienteId: cliente.id, camposExtras: montarCamposExtras() }),
      })
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        toastError('Modelo não disponível', d.error ?? 'Não foi possível gerar o documento')
        return
      }
      const blob = await res.blob()
      const url  = URL.createObjectURL(blob)
      const a    = document.createElement('a')
      a.href     = url
      a.download = `${tipoNome.replace(/\s+/g, '_')}_${cliente.nome.replace(/\s+/g, '_')}.docx`
      a.click()
      URL.revokeObjectURL(url)
      success('DOCX gerado!', 'Modelo do escritório preenchido.')
    } catch {
      toastError('Erro', 'Falha de rede')
    } finally {
      setBaixandoModelo(false)
    }
  }

  // Anexa o documento (markdown do editor) a "Documentos do Caso" — chamado
  // pelo botão Salvar E pelo AUTOSAVE do editor (silencioso: sem toasts, senão
  // cada alteração viraria notificação). O anexo grava atendimento_id e
  // cliente_id: o documento aparece no caso e no dossiê do cliente.
  async function salvarNoCaso(conteudo: string, opts?: { silencioso?: boolean }) {
    if (!atendimentoId) {
      if (!opts?.silencioso) toastError('Sem caso vinculado', 'Abra a geração a partir de um atendimento para anexar ao caso.')
      return
    }
    setSalvandoCaso(true)
    try {
      const res = await fetch(`/api/atendimentos/${atendimentoId}/documentos/anexar-gerado`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tipo: tipoModelo, titulo: tipoNome, conteudo, documentoId: documentoIdSalvo }),
      })
      const d = await res.json().catch(() => ({}))
      if (!res.ok) {
        if (!opts?.silencioso) toastError('Erro', d.error ?? 'Falha ao anexar ao caso')
        return
      }
      if (d.documento?.id) setDocumentoIdSalvo(d.documento.id)
      if (!opts?.silencioso) success('Anexado ao caso!', 'O documento está em Documentos do Caso e no dossiê do cliente.')
    } catch {
      if (!opts?.silencioso) toastError('Erro', 'Falha de rede')
    } finally {
      setSalvandoCaso(false)
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────

  if (modoEditor && documentoGerado) {
    return (
      <EditorDocumentoPronto
        titulo={tipoNome}
        conteudo={documentoGerado}
        onVoltar={() => {
          // Round-trip (pedido do dono): quem veio do atendimento VOLTA pro
          // atendimento — o editor descarrega o autosave antes de chamar aqui,
          // então o documento já está anexado ao sair.
          if (atendimentoId && clienteIdInicial) router.push(`/clientes/${clienteIdInicial}/casos/${atendimentoId}`)
          else if (clienteIdInicial) router.push(`/clientes/${clienteIdInicial}`)
          else setModoEditor(false)
        }}
        onSalvar={atendimentoId ? salvarNoCaso : undefined}
        salvando={salvandoCaso}
        exportOpts={
          tipoModelo === 'procuracao' || tipoModelo === 'declaracao_hipossuficiencia' || tipoModelo === 'substabelecimento'
            ? { compacto: true }   // documentos de 1 página
            : { contrato: true }   // contrato/notificação: denso, multi-página
        }
        extraAcoes={modeloDocxExiste && cliente ? (
          <Button
            size="sm"
            variant="secondary"
            onClick={baixarModelo}
            disabled={baixandoModelo}
            className="gap-1.5"
            title="Baixar no modelo .docx do escritório (formatação exata)"
          >
            {baixandoModelo ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileText className="h-4 w-4" />}
            Meu modelo (.docx)
          </Button>
        ) : undefined}
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
          <SeletorCliente onSelecionado={(c) => setCliente(c)} clienteSelecionado={cliente} />
        </CardContent>
      </Card>

      {/* 2. Status do modelo do escritório */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-lg">
            <FileText className="h-5 w-5 text-muted-foreground" />
            Modelo do escritório
          </CardTitle>
        </CardHeader>
        <CardContent>
          {carregandoModelo ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Verificando…
            </div>
          ) : modeloDocxExiste ? (
            <div className="flex items-center gap-2 rounded-lg border border-success/20 bg-success/5 px-4 py-3 text-sm font-medium text-success">
              <CheckCircle className="h-4 w-4 shrink-0" />
              Modelo .docx cadastrado — no editor, use &quot;Meu modelo (.docx)&quot; para o layout exato do escritório.
            </div>
          ) : (
            <div className="rounded-lg border border-amber-200 dark:border-amber-900 bg-amber-50 dark:bg-amber-950/40 px-4 py-3 text-sm text-amber-800 dark:text-amber-200">
              <div className="flex items-center gap-2 font-medium">
                <AlertCircle className="h-4 w-4 shrink-0" />
                Sem modelo .docx — a geração usará IA.
              </div>
              {suportaModelo && (
                <p className="mt-1 text-xs">
                  Para gerar no layout do escritório, cadastre o .docx em{' '}
                  <Link href="/configuracoes" className="font-medium underline">Configurações → Padrões</Link>.
                </p>
              )}
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
          <CardContent className="grid grid-cols-2 gap-4">
            <div className="col-span-2 sm:col-span-1">
              <Input
                label="Renda mensal aproximada"
                value={rendaMensal}
                onChange={(e) => setRendaMensal(formatarMoedaInput(e.target.value))}
                placeholder="Ex.: R$ 1.500,00"
                inputMode="numeric"
              />
            </div>
            <div className="col-span-2 sm:col-span-1">
              <Input
                label="Número de dependentes"
                value={numeroDependentes}
                onChange={(e) => setNumeroDependentes(e.target.value.replace(/\D/g, ''))}
                placeholder="Ex.: 2"
                inputMode="numeric"
              />
            </div>
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
                label="Valor fixo"
                value={valorFixo}
                onChange={(e) => setValorFixo(formatarMoedaInput(e.target.value))}
                placeholder="Ex.: R$ 3.000,00"
                inputMode="numeric"
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
          disabled={!cliente || gerando || carregandoModelo}
          loading={gerando}
          className="gap-2 bg-amber-600 hover:bg-amber-700"
        >
          <Zap className="h-5 w-5" />
          {gerando ? 'Gerando…' : `Gerar ${tipoNome}`}
        </Button>
      </div>
    </div>
  )
}
