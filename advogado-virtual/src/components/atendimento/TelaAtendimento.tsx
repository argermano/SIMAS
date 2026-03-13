'use client'

import { useState, useCallback, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { useToast } from '@/components/ui/toast'
import { useStreaming } from '@/components/shared/StreamingText'
import { SeletorCliente } from './SeletorCliente'
import { GravadorAudio } from './GravadorAudio'
import { MicrofoneInline } from './MicrofoneInline'
import { PlayerAudio } from './PlayerAudio'
import { UploadAudioTranscricao } from './UploadAudioTranscricao'
import { UploadDocumentos } from './UploadDocumentos'
import { SeletorTribunais } from './SeletorTribunais'
import { ConfirmarDadosModal } from './ConfirmarDadosModal'
import type { ResultadoJurisprudencia } from '@/lib/jurisprudencia/datajud'
import type { DadosExtraidosAutor, DadosExtraidosReu } from '@/lib/prompts/extracao/dados-cliente'
import { Mic, Keyboard, Users, FileText, MessageSquare, Save, Check, Zap, Loader2, UserCheck, MapPin, ScrollText, ExternalLink, FileSignature, FilePlus, Download, ClipboardCopy } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { AcessoRapidoFooter } from '@/components/acesso-rapido/AcessoRapidoFooter'
import { Badge } from '@/components/ui/badge'
import { TIPOS_PECA } from '@/lib/constants/tipos-peca'
import Link from 'next/link'

const ESTADOS_BR = [
  { value: 'AC', label: 'AC' }, { value: 'AL', label: 'AL' }, { value: 'AP', label: 'AP' },
  { value: 'AM', label: 'AM' }, { value: 'BA', label: 'BA' }, { value: 'CE', label: 'CE' },
  { value: 'DF', label: 'DF' }, { value: 'ES', label: 'ES' }, { value: 'GO', label: 'GO' },
  { value: 'MA', label: 'MA' }, { value: 'MT', label: 'MT' }, { value: 'MS', label: 'MS' },
  { value: 'MG', label: 'MG' }, { value: 'PA', label: 'PA' }, { value: 'PB', label: 'PB' },
  { value: 'PR', label: 'PR' }, { value: 'PE', label: 'PE' }, { value: 'PI', label: 'PI' },
  { value: 'RJ', label: 'RJ' }, { value: 'RN', label: 'RN' }, { value: 'RS', label: 'RS' },
  { value: 'RO', label: 'RO' }, { value: 'RR', label: 'RR' }, { value: 'SC', label: 'SC' },
  { value: 'SP', label: 'SP' }, { value: 'SE', label: 'SE' }, { value: 'TO', label: 'TO' },
]

function TranscricaoActions({ texto }: { texto: string }) {
  const [copiado, setCopiado] = useState(false)

  const copiar = useCallback(async () => {
    await navigator.clipboard.writeText(texto)
    setCopiado(true)
    setTimeout(() => setCopiado(false), 2000)
  }, [texto])

  const exportar = useCallback(() => {
    const blob = new Blob([texto], { type: 'text/plain;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `transcricao_${new Date().toISOString().slice(0, 10)}.txt`
    a.click()
    URL.revokeObjectURL(url)
  }, [texto])

  return (
    <div className="flex items-center gap-1">
      <button
        onClick={copiar}
        className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
        title="Copiar transcrição"
      >
        {copiado ? <Check className="h-3.5 w-3.5 text-green-600" /> : <ClipboardCopy className="h-3.5 w-3.5" />}
      </button>
      <button
        onClick={exportar}
        className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
        title="Exportar como .txt"
      >
        <Download className="h-3.5 w-3.5" />
      </button>
    </div>
  )
}

interface TelaAtendimentoProps {
  area: string
  tipoPeca: string
  tipoPecaNome: string
  tenantId: string
  userId: string
  roleUsuario: string
  tiposDocumento: string[]
  atendimentoIdInicial?: string
  clienteIdInicial?: string
}

export function TelaAtendimento({
  area,
  tipoPeca,
  tipoPecaNome,
  tenantId,
  userId,
  roleUsuario,
  tiposDocumento,
  atendimentoIdInicial,
  clienteIdInicial,
}: TelaAtendimentoProps) {
  const router = useRouter()
  const { success, error: toastError } = useToast()
  const { text: textoGerado, loading: gerando, error: erroStream, startStream } = useStreaming()

  // Estado do atendimento
  const [atendimentoId, setAtendimentoId]     = useState<string | null>(atendimentoIdInicial ?? null)
  const [cliente, setCliente]                   = useState<{ id: string; nome: string } | null>(null)
  const [modoInput, setModoInput]               = useState<'durante_reuniao' | 'pos_reuniao' | 'texto'>('durante_reuniao')
  const [textoRelato, setTextoRelato]           = useState('')
  const [transcricao, setTranscricao]           = useState('')
  const [pedidoEspecifico, setPedidoEspecifico] = useState('')
  const [salvando, setSalvando]                 = useState(false)
  const [salvo, setSalvo]                       = useState(false)
  const [carregando, setCarregando]             = useState(!!atendimentoIdInicial)
  const [mostraModalGeracao, setMostraModalGeracao] = useState(false)
  const [jurisprudencia, setJurisprudencia] = useState<ResultadoJurisprudencia[]>([])
  const [tribunaisSelecionados, setTribunaisSelecionados] = useState<string[]>([])
  const [localizacao, setLocalizacao] = useState({ cidade: '', estado: '' })
  const localizacaoOriginalRef = useRef({ cidade: '', estado: '' })
  const [hasAudio, setHasAudio] = useState(false)
  const [extraindo, setExtraindo] = useState(false)
  const [documentosExistentes, setDocumentosExistentes] = useState<Array<{ id: string; file_name: string; tipo: string; texto_extraido?: string }>>([])
  const [pecasExistentes, setPecasExistentes] = useState<Array<{ id: string; tipo: string; area: string; versao: number; status: string; created_at: string }>>([])
  const [contratosExistentes, setContratosExistentes] = useState<Array<{ id: string; titulo: string; status: string; area: string; created_at: string }>>([])
  const [dadosExtraidos, setDadosExtraidos] = useState<{ autor: DadosExtraidosAutor; reu?: DadosExtraidosReu } | null>(null)
  const [dadosAtuaisCliente, setDadosAtuaisCliente] = useState<Partial<DadosExtraidosAutor>>({})
  const qualificacaoRef = useRef<{ autor?: DadosExtraidosAutor; reu?: DadosExtraidosReu } | undefined>(undefined)

  // Carregar atendimento existente
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
          // Buscar localização do cliente
          try {
            const resCliente = await fetch(`/api/clientes/${at.cliente_id}`)
            if (resCliente.ok) {
              const dadosCliente = await resCliente.json()
              const loc = { cidade: dadosCliente.cliente?.cidade ?? '', estado: dadosCliente.cliente?.estado ?? '' }
              setLocalizacao(loc)
              localizacaoOriginalRef.current = loc
            }
          } catch { /* silencioso */ }
        }
        const modoSalvo = at.modo_input
        setModoInput(modoSalvo === 'texto' ? 'texto' : modoSalvo === 'pos_reuniao' ? 'pos_reuniao' : 'durante_reuniao')
        setTextoRelato(at.transcricao_editada ?? at.transcricao_raw ?? '')
        setTranscricao(at.transcricao_editada ?? at.transcricao_raw ?? '')
        setPedidoEspecifico(at.pedidos_especificos ?? '')
        if (at.audio_url) setHasAudio(true)
        if (at.documentos) setDocumentosExistentes(at.documentos)
        if (at.pecas) setPecasExistentes(at.pecas)
        if (data.contratos) setContratosExistentes(data.contratos)
      } catch {
        toastError('Erro', 'Não foi possível carregar o atendimento')
      } finally {
        setCarregando(false)
      }
    }
    carregar()
  }, [atendimentoIdInicial, toastError])

  // Criar atendimento ao selecionar cliente
  const handleClienteSelecionado = useCallback(async (c: { id: string; nome: string } | null) => {
    if (!c) {
      setCliente(null)
      setAtendimentoId(null)
      setLocalizacao({ cidade: '', estado: '' })
      localizacaoOriginalRef.current = { cidade: '', estado: '' }
      return
    }

    setCliente(c)

    // Buscar localização do cliente
    try {
      const resCliente = await fetch(`/api/clientes/${c.id}`)
      if (resCliente.ok) {
        const dadosCliente = await resCliente.json()
        const loc = { cidade: dadosCliente.cliente?.cidade ?? '', estado: dadosCliente.cliente?.estado ?? '' }
        setLocalizacao(loc)
        localizacaoOriginalRef.current = loc
      }
    } catch { /* silencioso */ }

    // Cria atendimento se ainda não existe
    if (!atendimentoId) {
      try {
        const res = await fetch('/api/atendimentos', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            cliente_id: c.id,
            area,
            tipo_peca_origem: tipoPeca,
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
  }, [atendimentoId, area, tipoPeca, modoInput, toastError])

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

  // Receber transcrição do gravador
  const handleTranscricao = useCallback((texto: string) => {
    setTranscricao(texto)
    setTextoRelato(texto)
    setHasAudio(true)
    success('Áudio transcrito', 'Revise o texto abaixo e edite se necessário.')
  }, [success])

  // Salvar atendimento
  async function salvar() {
    if (!atendimentoId) return

    setSalvando(true)
    try {
      const textoFinal = textoRelato

      // Salvar localização do cliente se foi alterada
      if (cliente) {
        const orig = localizacaoOriginalRef.current
        if (localizacao.cidade !== orig.cidade || localizacao.estado !== orig.estado) {
          await fetch(`/api/clientes/${cliente.id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ cidade: localizacao.cidade || null, estado: localizacao.estado || null }),
          })
          localizacaoOriginalRef.current = { ...localizacao }
        }
      }

      const res = await fetch(`/api/atendimentos/${atendimentoId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          transcricao_editada: textoFinal,
          pedidos_especificos: pedidoEspecifico,
          modo_input: modoInput === 'texto' ? 'texto' : 'audio',
        }),
      })

      if (res.ok) {
        setSalvo(true)
        success('Atendimento salvo!', 'O caso foi registrado com sucesso.')
        setTimeout(() => setSalvo(false), 2000)
      } else {
        const data = await res.json()
        toastError('Erro ao salvar', data.error ?? 'Tente novamente')
      }
    } catch {
      toastError('Erro', 'Falha de rede ao salvar')
    } finally {
      setSalvando(false)
    }
  }

  // Gerar peça com IA — Fase 1: salva, extrai dados dos documentos, mostra modal de confirmação
  async function gerarPeca() {
    if (!atendimentoId) return

    setSalvando(true)
    try {
      // 0. Salvar localização do cliente se foi alterada
      if (cliente) {
        const orig = localizacaoOriginalRef.current
        if (localizacao.cidade !== orig.cidade || localizacao.estado !== orig.estado) {
          await fetch(`/api/clientes/${cliente.id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ cidade: localizacao.cidade || null, estado: localizacao.estado || null }),
          })
          localizacaoOriginalRef.current = { ...localizacao }
        }
      }

      // 1. Salva o atendimento atualizado
      await fetch(`/api/atendimentos/${atendimentoId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          transcricao_editada: textoRelato,
          pedidos_especificos: pedidoEspecifico,
          modo_input: modoInput === 'texto' ? 'texto' : 'audio',
        }),
      })
    } finally {
      setSalvando(false)
    }

    // 2. Extrair dados dos documentos
    setExtraindo(true)
    try {
      const res = await fetch('/api/ia/extrair-dados-cliente', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ atendimentoId }),
      })
      if (res.ok) {
        const dados = await res.json()
        // Se encontrou dados relevantes, mostra modal de confirmação
        if (dados.autor && Object.values(dados.autor).some(Boolean)) {
          // Buscar dados atuais do cliente para comparação
          if (cliente) {
            try {
              const resCliente = await fetch(`/api/clientes/${cliente.id}`)
              if (resCliente.ok) {
                const { cliente: cl } = await resCliente.json()
                setDadosAtuaisCliente({
                  nome: cl?.nome, cpf: cl?.cpf, rg: cl?.rg,
                  orgao_expedidor: cl?.orgao_expedidor, estado_civil: cl?.estado_civil,
                  nacionalidade: cl?.nacionalidade, profissao: cl?.profissao,
                  endereco: cl?.endereco, bairro: cl?.bairro, cidade: cl?.cidade,
                  estado: cl?.estado, cep: cl?.cep, telefone: cl?.telefone, email: cl?.email,
                })
              }
            } catch { /* silencioso */ }
          }
          setDadosExtraidos(dados)
          setExtraindo(false)
          return // Aguarda confirmação do modal antes de continuar
        }
      }
    } catch {
      console.warn('[gerarPeca] Falha ao extrair dados (não crítico)')
    }
    setExtraindo(false)

    // Se não encontrou dados ou falhou, continua direto
    continuarGeracao()
  }

  // Confirmação do modal de dados: atualiza cliente e continua geração
  async function handleConfirmarDados(dados: { autor: DadosExtraidosAutor; reu?: DadosExtraidosReu }) {
    setDadosExtraidos(null)

    // Atualizar cadastro do cliente com os dados confirmados
    if (cliente && dados.autor) {
      try {
        const update: Record<string, string | null> = {}
        const fields: (keyof DadosExtraidosAutor)[] = [
          'nome', 'cpf', 'rg', 'orgao_expedidor', 'estado_civil', 'nacionalidade',
          'profissao', 'endereco', 'bairro', 'cidade', 'estado', 'cep', 'telefone', 'email',
        ]
        for (const f of fields) {
          if (dados.autor[f]) update[f] = dados.autor[f]!
        }
        if (Object.keys(update).length > 0) {
          await fetch(`/api/clientes/${cliente.id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(update),
          })
        }
      } catch {
        console.warn('[gerarPeca] Falha ao atualizar cliente (não crítico)')
      }
    }

    qualificacaoRef.current = dados
    continuarGeracao(dados)
  }

  // Pular confirmação de dados
  function handlePularDados() {
    setDadosExtraidos(null)
    continuarGeracao()
  }

  // Fase 2: streaming da peça + redirecionamento
  async function continuarGeracao(qualificacao?: { autor?: DadosExtraidosAutor; reu?: DadosExtraidosReu }) {
    if (!atendimentoId) return

    setMostraModalGeracao(true)

    const resultado = await startStream('/api/ia/gerar-peca', {
      atendimentoId,
      tipo: tipoPeca,
      area,
      jurisprudencia,
      tribunais: tribunaisSelecionados,
      qualificacao: qualificacao ?? qualificacaoRef.current,
    })

    if (!resultado) {
      setMostraModalGeracao(false)
      toastError('Erro', erroStream ?? 'Falha ao gerar a peça. Tente novamente.')
      return
    }

    const { fullText, headers } = resultado
    const pecaId = headers.get('X-Peca-Id')

    if (!pecaId) {
      setMostraModalGeracao(false)
      toastError('Erro', 'Não foi possível identificar a peça gerada.')
      return
    }

    // 3. Salva o conteúdo gerado no banco
    await fetch('/api/ia/salvar-peca', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pecaId, conteudo: fullText }),
    })

    // 4. Atualiza status do atendimento para peca_gerada
    await fetch(`/api/atendimentos/${atendimentoId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'peca_gerada' }),
    })

    // 5. Colaboradores não vão direto ao editor — peça aguarda revisão
    if (roleUsuario === 'colaborador') {
      success('Peça enviada para revisão!', 'Um advogado ou administrador irá avaliar e aprovar a peça.')
      router.push(`/${area}`)
      return
    }

    // 6. Outros perfis vão direto ao editor
    router.push(`/${area}/editor/${pecaId}`)
  }

  const podeGravar = !!atendimentoId
  const podeSalvar = !!atendimentoId && (textoRelato.trim().length > 0 || transcricao.trim().length > 0 || pedidoEspecifico.trim().length > 0)

  if (carregando) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="text-center space-y-3">
          <div className="mx-auto h-8 w-8 animate-spin rounded-full border-4 border-primary/20 border-t-primary" />
          <p className="text-sm text-muted-foreground">Carregando atendimento...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">

      {/* Modal de geração com streaming */}
      {mostraModalGeracao && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-lg rounded-2xl bg-card shadow-2xl">
            <div className="border-b px-6 py-4">
              <h2 className="text-lg font-semibold text-foreground">Gerando {tipoPecaNome} com IA</h2>
              <p className="mt-0.5 text-sm text-muted-foreground">
                Isto pode levar até 45 segundos. Não feche a janela.
              </p>
            </div>
            <div className="px-6 py-4">
              <div className="h-52 overflow-y-auto rounded-xl border bg-muted/50 p-3 font-mono text-xs leading-relaxed text-foreground">
                {textoGerado ? (
                  <>
                    {textoGerado}
                    {gerando && (
                      <span className="inline-block h-3.5 w-0.5 animate-pulse bg-primary/70 ml-0.5 align-middle" />
                    )}
                  </>
                ) : (
                  <div className="flex items-center gap-2 py-4 text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Iniciando geração...
                  </div>
                )}
              </div>
            </div>
            <div className="border-t px-6 py-4 text-center">
              <p className="text-xs text-muted-foreground">
                {gerando ? 'Gerando...' : 'Finalizando e salvando...'}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Modal de extração de dados em andamento */}
      {extraindo && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="rounded-2xl bg-card shadow-2xl px-8 py-6 text-center space-y-3">
            <Loader2 className="h-8 w-8 animate-spin text-primary mx-auto" />
            <p className="text-sm font-medium text-foreground">Extraindo dados dos documentos...</p>
            <p className="text-xs text-muted-foreground">Analisando documentos com IA para preencher qualificação</p>
          </div>
        </div>
      )}

      {/* Modal de confirmação de dados extraídos */}
      {dadosExtraidos && (
        <ConfirmarDadosModal
          open={!!dadosExtraidos}
          onClose={() => setDadosExtraidos(null)}
          dadosExtraidos={dadosExtraidos}
          dadosAtuaisCliente={dadosAtuaisCliente}
          onConfirmar={handleConfirmarDados}
          onPular={handlePularDados}
        />
      )}

      {/* Documentos gerados neste caso */}
      {(pecasExistentes.length > 0 || contratosExistentes.length > 0 || cliente) && (
        <Card className="border-primary/20 bg-primary/5">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-lg">
              <ScrollText className="h-5 w-5 text-primary" />
              Documentos do caso
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {/* Peças */}
            {pecasExistentes.length > 0 && (
              <div className="space-y-1.5">
                <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Peças processuais</p>
                {pecasExistentes.map(peca => {
                  const tipoCfg = TIPOS_PECA[peca.tipo]
                  const badgeVariant = peca.status === 'aprovada' ? 'success' as const
                    : peca.status === 'revisada' ? 'default' as const
                    : 'secondary' as const
                  const statusLabel = peca.status === 'aprovada' ? 'Aprovada'
                    : peca.status === 'revisada' ? 'Revisada'
                    : peca.status === 'exportada' ? 'Exportada'
                    : 'Rascunho'
                  return (
                    <Link
                      key={peca.id}
                      href={`/${peca.area}/editor/${peca.id}`}
                      className="flex items-center justify-between rounded-lg border bg-card px-3 py-2.5 hover:bg-muted/50 transition-colors group"
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <FileText className="h-4 w-4 text-primary shrink-0" />
                        <span className="text-sm font-medium text-foreground truncate">
                          {tipoCfg?.nome ?? peca.tipo}
                        </span>
                        <Badge variant={badgeVariant} className="text-[10px] px-1.5 py-0 shrink-0">
                          {statusLabel}
                        </Badge>
                        <span className="text-[11px] text-muted-foreground shrink-0">v{peca.versao}</span>
                      </div>
                      <ExternalLink className="h-3.5 w-3.5 text-muted-foreground group-hover:text-primary shrink-0 transition-colors" />
                    </Link>
                  )
                })}
              </div>
            )}

            {/* Contratos */}
            {contratosExistentes.length > 0 && (
              <div className="space-y-1.5">
                <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Contratos</p>
                {contratosExistentes.map(contrato => {
                  const badgeVariant = contrato.status === 'aprovado' ? 'success' as const
                    : contrato.status === 'exportado' ? 'success' as const
                    : 'secondary' as const
                  const statusLabel = contrato.status === 'aprovado' ? 'Aprovado'
                    : contrato.status === 'exportado' ? 'Exportado'
                    : contrato.status === 'em_revisao' ? 'Em revisão'
                    : 'Rascunho'
                  return (
                    <Link
                      key={contrato.id}
                      href={`/contratos/${contrato.id}`}
                      className="flex items-center justify-between rounded-lg border bg-card px-3 py-2.5 hover:bg-muted/50 transition-colors group"
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <FileSignature className="h-4 w-4 text-primary shrink-0" />
                        <span className="text-sm font-medium text-foreground truncate">
                          {contrato.titulo}
                        </span>
                        <Badge variant={badgeVariant} className="text-[10px] px-1.5 py-0 shrink-0">
                          {statusLabel}
                        </Badge>
                      </div>
                      <ExternalLink className="h-3.5 w-3.5 text-muted-foreground group-hover:text-primary shrink-0 transition-colors" />
                    </Link>
                  )
                })}
              </div>
            )}

            {/* Ações rápidas: gerar documentos */}
            {cliente && (
              <div className="space-y-1.5">
                <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Gerar documentos</p>
                <div className="flex flex-wrap gap-2">
                  <Link
                    href={`/${area}/modelos/procuracao?clienteId=${cliente.id}`}
                    className="flex items-center gap-1.5 rounded-lg border bg-card px-3 py-2 text-sm font-medium text-foreground hover:bg-muted/50 transition-colors"
                  >
                    <FilePlus className="h-3.5 w-3.5 text-muted-foreground" />
                    Procuração
                  </Link>
                  <Link
                    href={`/${area}/modelos/declaracao_hipossuficiencia?clienteId=${cliente.id}`}
                    className="flex items-center gap-1.5 rounded-lg border bg-card px-3 py-2 text-sm font-medium text-foreground hover:bg-muted/50 transition-colors"
                  >
                    <FilePlus className="h-3.5 w-3.5 text-muted-foreground" />
                    Declaração de Hipossuficiência
                  </Link>
                  {contratosExistentes.length === 0 && (
                    <Link
                      href={`/contratos/novo?cliente_id=${cliente.id}`}
                      className="flex items-center gap-1.5 rounded-lg border bg-card px-3 py-2 text-sm font-medium text-foreground hover:bg-muted/50 transition-colors"
                    >
                      <FilePlus className="h-3.5 w-3.5 text-muted-foreground" />
                      Contrato de Honorários
                    </Link>
                  )}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* 1. Seleção de Cliente */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-lg">
            <Users className="h-5 w-5 text-muted-foreground" />
            Cliente
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <SeletorCliente
            onSelecionado={handleClienteSelecionado}
            clienteSelecionado={cliente}
          />
          {cliente && (
            <div>
              <p className="mb-2 flex items-center gap-1.5 text-sm font-medium text-muted-foreground">
                <MapPin className="h-3.5 w-3.5" />
                Localização do cliente
              </p>
              <div className="grid grid-cols-3 gap-3">
                <div className="col-span-2">
                  <Input
                    label="Município"
                    value={localizacao.cidade}
                    onChange={(e) => setLocalizacao(l => ({ ...l, cidade: e.target.value }))}
                    placeholder="Ex.: São Paulo"
                  />
                </div>
                <Select
                  label="UF"
                  value={localizacao.estado}
                  onChange={(e) => setLocalizacao(l => ({ ...l, estado: e.target.value }))}
                  options={ESTADOS_BR}
                  placeholder="UF"
                />
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* 2. Relato do Caso */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-lg">
            <MessageSquare className="h-5 w-5 text-muted-foreground" />
            Relato de Caso | Atendimento Cliente
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Tabs: 3 modos de entrada */}
          <div className="flex rounded-lg border bg-muted/50 p-1 gap-1">
            <button
              onClick={() => setModoInput('durante_reuniao')}
              className={`flex flex-1 items-center justify-center gap-2 rounded-md px-3 py-2.5 text-sm font-medium transition-colors ${
                modoInput === 'durante_reuniao'
                  ? 'bg-card text-primary shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              <UserCheck className="h-4 w-4" />
              Gravar com cliente
            </button>
            <button
              onClick={() => setModoInput('pos_reuniao')}
              className={`flex flex-1 items-center justify-center gap-2 rounded-md px-3 py-2.5 text-sm font-medium transition-colors ${
                modoInput === 'pos_reuniao'
                  ? 'bg-card text-primary shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              <Mic className="h-4 w-4" />
              Relato pós-reunião
            </button>
            <button
              onClick={() => setModoInput('texto')}
              className={`flex flex-1 items-center justify-center gap-2 rounded-md px-3 py-2.5 text-sm font-medium transition-colors ${
                modoInput === 'texto'
                  ? 'bg-card text-primary shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              <Keyboard className="h-4 w-4" />
              Digitar
            </button>
          </div>

          {/* Conteúdo da tab */}
          {modoInput === 'durante_reuniao' && (
            <div className="space-y-4">
              <p className="text-xs text-muted-foreground">
                Grave o áudio <strong>com o cliente presente</strong>. O consentimento LGPD será solicitado antes de iniciar.
              </p>
              <GravadorAudio
                onTranscricao={handleTranscricao}
                atendimentoId={atendimentoId}
                disabled={!podeGravar}
                requerConsentimento={true}
              />
              {transcricao && (
                <Textarea
                  label="Transcrição (edite se necessário)"
                  value={textoRelato}
                  onChange={(e) => setTextoRelato(e.target.value)}
                  placeholder="A transcrição aparecerá aqui..."
                  rows={8}
                />
              )}
            </div>
          )}

          {modoInput === 'pos_reuniao' && (
            <div className="space-y-4">
              <p className="text-xs text-muted-foreground">
                Relate os fatos com <strong>suas próprias palavras</strong> após a reunião. Sem necessidade de consentimento LGPD.
              </p>
              <GravadorAudio
                onTranscricao={handleTranscricao}
                atendimentoId={atendimentoId}
                disabled={!podeGravar}
                requerConsentimento={false}
              />

              {/* Separador */}
              <div className="flex items-center gap-3">
                <div className="h-px flex-1 bg-border" />
                <span className="text-xs text-muted-foreground">ou</span>
                <div className="h-px flex-1 bg-border" />
              </div>

              {/* Upload de arquivo de áudio */}
              <UploadAudioTranscricao
                onTranscricao={handleTranscricao}
                atendimentoId={atendimentoId}
                disabled={!podeGravar}
              />

              {transcricao && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium text-foreground">Transcrição (edite se necessário)</span>
                    <TranscricaoActions texto={textoRelato} />
                  </div>
                  <Textarea
                    value={textoRelato}
                    onChange={(e) => setTextoRelato(e.target.value)}
                    placeholder="A transcrição aparecerá aqui..."
                    rows={8}
                  />
                </div>
              )}
            </div>
          )}

          {modoInput === 'texto' && (
            <Textarea
              label="Descreva o caso"
              value={textoRelato}
              onChange={(e) => setTextoRelato(e.target.value)}
              placeholder="Descreva os fatos, o histórico e a situação atual do cliente..."
              hint="Quanto mais detalhado, melhor será a peça gerada pela IA"
              rows={8}
              disabled={!podeGravar}
            />
          )}

          {hasAudio && atendimentoId && (
            <PlayerAudio atendimentoId={atendimentoId} />
          )}
        </CardContent>
      </Card>

      {/* 3. Pedido Específico */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-lg">
            <FileText className="h-5 w-5 text-muted-foreground" />
            Pedido específico
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <Textarea
            label="O que o cliente deseja? (opcional)"
            value={pedidoEspecifico}
            onChange={(e) => setPedidoEspecifico(e.target.value)}
            placeholder={`Ex.: ${tipoPecaNome} para aposentadoria por tempo de contribuição com reconhecimento de atividade especial`}
            hint="Detalhe o pedido principal — isso ajudará a IA a gerar uma peça mais precisa"
            rows={3}
            disabled={!podeGravar}
          />
          {podeGravar && (
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">Ou dite:</span>
              <MicrofoneInline
                onTranscricao={(t) => setPedidoEspecifico(prev => prev ? prev + ' ' + t : t)}
                disabled={!podeGravar}
              />
            </div>
          )}
        </CardContent>
      </Card>

      {/* 4. Documentos */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-lg">
            <FileText className="h-5 w-5 text-muted-foreground" />
            Documentos
          </CardTitle>
        </CardHeader>
        <CardContent>
          <UploadDocumentos
            atendimentoId={atendimentoId}
            tiposDocumento={tiposDocumento}
            disabled={!podeGravar}
            documentosIniciais={documentosExistentes}
          />
        </CardContent>
      </Card>

      {/* 5. Jurisprudência */}
      <SeletorTribunais
        area={area}
        disabled={!podeGravar}
        onResultados={setJurisprudencia}
        onTribunaisChange={setTribunaisSelecionados}
      />

      {/* 6. Botões de ação */}
      <div className="flex flex-wrap justify-end gap-3 pb-8">
        <Button
          variant="secondary"
          size="lg"
          onClick={() => router.push(`/${area}`)}
          disabled={salvando || gerando}
        >
          Cancelar
        </Button>
        <Button
          variant="secondary"
          size="lg"
          onClick={salvar}
          disabled={!podeSalvar || salvando || gerando}
          loading={salvando}
          className="gap-2"
        >
          {salvo ? (
            <>
              <Check className="h-5 w-5" />
              Salvo!
            </>
          ) : (
            <>
              <Save className="h-5 w-5" />
              Salvar
            </>
          )}
        </Button>
        <Button
          size="lg"
          onClick={gerarPeca}
          disabled={!podeSalvar || salvando || gerando || extraindo}
          className="gap-2 bg-primary/80 hover:bg-primary"
        >
          <Zap className="h-5 w-5" />
          Gerar Peça IA
        </Button>
      </div>

      {/* Acesso Rápido */}
      <div className="border-t pt-6">
        <AcessoRapidoFooter
          atendimentoId={atendimentoId}
          clienteId={cliente?.id ?? null}
          area={area}
        />
      </div>

    </div>
  )
}
