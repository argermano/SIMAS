'use client'

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Spinner } from '@/components/ui/spinner'
import { cn, formatarData, formatarDataHora } from '@/lib/utils'
import {
  AlignJustify,
  AlertTriangle,
  ArrowRight,
  CalendarDays,
  Check,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Inbox,
  LayoutList,
  Newspaper,
  RotateCcw,
  Search,
  User,
  X,
} from 'lucide-react'
import { useToast } from '@/components/ui/toast'
import { SaudeWidget } from './SaudeWidget'
import { PainelDetalhe } from './PainelDetalhe'
import { PrioridadeBadge, StatusPill } from './Pills'
import { SentinelaPanel } from './SentinelaPanel'
import {
  hojeSaoPaulo,
  prioridadeDaPublicacao,
  type PrioridadeHint,
  type PublicacaoListItem,
  type SaudePublicacoes,
  type SentinelaAlerta,
  type TeamMember,
} from './tipos'

const STATUS_OPCOES = [
  { value: '', label: 'Todos os status' },
  { value: 'nova', label: 'Não tratadas' },
  { value: 'triada', label: 'Tratadas (sem tarefa)' },
  { value: 'tarefa_criada', label: 'Tratadas (com tarefa)' },
  { value: 'descartada', label: 'Descartadas' },
]

// Ordenação atendida pelo servidor (o banco pagina por data; prioridade é
// ordenada em memória lá). Valores casam com o enum da rota (`data`|`prioridade`).
const ORDENAR_OPCOES = [
  { value: 'data', label: 'Mais recentes' },
  { value: 'prioridade', label: 'Prioridade' },
]

const DENSIDADE_KEY = 'publicacoes:densidade'
type Densidade = 'confortavel' | 'compacto'

interface Resposta {
  publicacoes: PublicacaoListItem[]
  total: number
  pagina: number
  totalPaginas: number
}

/** Um filtro aplicável por um tile de contador. `statusIn` (união de status,
 * CSV) e `triadaEm` (recorte por `triada_em` num dia) permitem que o clique
 * abra EXATAMENTE os itens contados; string vazia = dimensão não aplicada. */
interface FiltroTile {
  status: string
  statusIn: string
  de: string
  ate: string
  triadaEm: string
}

export function CaixaPublicacoes({ teamMembers }: { teamMembers: TeamMember[] }) {
  const { success, error: toastError } = useToast()
  const [concluindo, setConcluindo] = useState<string | null>(null)
  const [status, setStatus] = useState('nova')
  const [statusIn, setStatusIn] = useState('')
  const [tribunal, setTribunal] = useState('')
  const [oab, setOab] = useState('')
  const [de, setDe] = useState('')
  const [ate, setAte] = useState('')
  const [triadaEm, setTriadaEm] = useState('')
  const [q, setQ] = useState('')
  const [qDebounced, setQDebounced] = useState('')
  const [page, setPage] = useState(1)

  // Filtro de tipo e ordenação são atendidos pelo SERVIDOR (paginação correta).
  const [tipo, setTipo] = useState('')
  const [ordenar, setOrdenar] = useState('data')
  const [densidade, setDensidade] = useState<Densidade>('confortavel')

  const [dados, setDados] = useState<Resposta | null>(null)
  const [loading, setLoading] = useState(true)
  const [tribunais, setTribunais] = useState<string[]>([]) // acumula siglas vistas
  const [oabs, setOabs] = useState<{ num: string; uf: string }[]>([]) // acumula OABs vistas
  const [tipos, setTipos] = useState<string[]>([]) // acumula tipos de documento vistos
  const [selecionada, setSelecionada] = useState<string | null>(null)
  const [mobileAberto, setMobileAberto] = useState(false) // overlay de detalhe (< lg)
  // lg+ mostra o detalhe inline; < lg mostra overlay ao tocar. Só UM painel monta
  // por vez (evita fetch duplicado). Default desktop-first (casa com o SSR).
  const [desktop, setDesktop] = useState(true)

  const [saude, setSaude] = useState<SaudePublicacoes | null>(null)
  const [loadingSaude, setLoadingSaude] = useState(true)
  // Alertas da sentinela DataJud × DJEN (painel âmbar; só abertos são exibidos).
  const [sentinela, setSentinela] = useState<SentinelaAlerta[]>([])

  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined)
  // Snapshot mais recente da lista, para a fila "próxima não tratada" avançar
  // sem depender do fechamento (closure) do callback.
  const listaRef = useRef<PublicacaoListItem[]>([])
  // Seleciona o 1º item no próximo carregamento disparado por FILTRO (não após ações).
  const autoSelecionar = useRef(true)

  // Rastreia o breakpoint lg (1024px) para montar só um painel de detalhe.
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 1024px)')
    const upd = () => setDesktop(mq.matches)
    upd()
    mq.addEventListener('change', upd)
    return () => mq.removeEventListener('change', upd)
  }, [])

  // Densidade persistida em localStorage.
  useEffect(() => {
    try {
      const salvo = localStorage.getItem(DENSIDADE_KEY)
      if (salvo === 'compacto' || salvo === 'confortavel') setDensidade(salvo)
    } catch { /* ignore */ }
  }, [])
  function mudarDensidade(d: Densidade) {
    setDensidade(d)
    try { localStorage.setItem(DENSIDADE_KEY, d) } catch { /* ignore */ }
  }

  // Debounce da busca
  useEffect(() => {
    clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      setQDebounced(q.trim())
      setPage(1)
    }, 400)
    return () => clearTimeout(debounceRef.current)
  }, [q])

  const carregar = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      // `statusIn` (união) tem precedência sobre `status` único no servidor.
      if (statusIn) params.set('statusIn', statusIn)
      else if (status) params.set('status', status)
      if (tribunal) params.set('tribunal', tribunal)
      if (oab) params.set('oab', oab)
      if (tipo) params.set('tipo', tipo)
      if (de) params.set('de', de)
      if (ate) params.set('ate', ate)
      if (triadaEm) params.set('triadaEm', triadaEm)
      if (qDebounced) params.set('q', qDebounced)
      if (ordenar) params.set('ordenar', ordenar)
      params.set('page', String(page))
      const r = await fetch(`/api/publicacoes?${params.toString()}`)
      if (r.ok) {
        const d: Resposta = await r.json()
        setDados(d)
        listaRef.current = d.publicacoes
        // Acumula tribunais conhecidos (união crescente) para o filtro
        setTribunais((prev) => {
          const set = new Set(prev)
          for (const p of d.publicacoes) if (p.sigla_tribunal) set.add(p.sigla_tribunal)
          return Array.from(set).sort()
        })
        // Acumula OABs consultadas (união crescente) para o filtro; filtra por
        // `oab_consultada` (número) mas exibe com a UF.
        setOabs((prev) => {
          const map = new Map(prev.map((o) => [o.num, o.uf]))
          for (const p of d.publicacoes) {
            if (p.oab_consultada) map.set(p.oab_consultada, p.uf_oab ?? '')
          }
          return Array.from(map, ([num, uf]) => ({ num, uf })).sort((a, b) => a.num.localeCompare(b.num))
        })
        // Acumula tipos de documento vistos (refino de página do lado do cliente).
        setTipos((prev) => {
          const set = new Set(prev)
          for (const p of d.publicacoes) {
            const t = p.tipo_documento || p.tipo_comunicacao
            if (t) set.add(t)
          }
          return Array.from(set).sort()
        })
      }
    } finally {
      setLoading(false)
    }
  }, [status, statusIn, tribunal, oab, tipo, de, ate, triadaEm, qDebounced, ordenar, page])

  const carregarSaude = useCallback(async () => {
    setLoadingSaude(true)
    try {
      const r = await fetch('/api/publicacoes/saude')
      if (r.ok) setSaude((await r.json()) as SaudePublicacoes)
    } finally {
      setLoadingSaude(false)
    }
  }, [])

  // Sentinela DataJud × DJEN — silenciosa em falha (o painel só aparece com
  // alertas abertos; erro aqui nunca pode derrubar a caixa de publicações).
  const carregarSentinela = useCallback(async () => {
    try {
      const r = await fetch('/api/publicacoes/sentinela')
      if (r.ok) {
        const d = (await r.json()) as { alertas?: SentinelaAlerta[] }
        setSentinela(d.alertas ?? [])
      }
    } catch {
      /* ignore */
    }
  }, [])

  // Carregamento disparado por FILTRO → arma a auto-seleção do 1º item.
  useEffect(() => {
    autoSelecionar.current = true
    void carregar()
  }, [carregar])
  useEffect(() => { void carregarSaude() }, [carregarSaude])
  useEffect(() => { void carregarSentinela() }, [carregarSentinela])

  // Seleciona a 1ª publicação ao carregar por filtro (nunca sobrescreve o avanço
  // pós-ação, que recarrega direto sem rearmar a flag).
  useEffect(() => {
    if (!dados) return
    if (autoSelecionar.current) {
      autoSelecionar.current = false
      setSelecionada(dados.publicacoes[0]?.id ?? null)
    }
  }, [dados])

  function limpar() {
    setStatus('')
    setStatusIn('')
    setTribunal('')
    setOab('')
    setDe('')
    setAte('')
    setTriadaEm('')
    setTipo('')
    setQ('')
    setQDebounced('')
    setPage(1)
  }

  /** Aplica um filtro de tile de forma atômica (status/união + recortes de data). */
  function aplicarFiltro(f: FiltroTile) {
    setStatus(f.status)
    setStatusIn(f.statusIn)
    setDe(f.de)
    setAte(f.ate)
    setTriadaEm(f.triadaEm)
    setPage(1)
  }

  /** Da fila atual (snapshot), a próxima publicação 'nova' após `atualId`. */
  function proximaNova(atualId: string): string | null {
    const lst = listaRef.current
    const idx = lst.findIndex((p) => p.id === atualId)
    const inicio = idx >= 0 ? idx + 1 : 0
    for (let i = inicio; i < lst.length; i++) {
      if (lst[i].status === 'nova' && lst[i].id !== atualId) return lst[i].id
    }
    return null
  }

  /** Após tratar/descartar: avança para a próxima não tratada (ou fecha) e
   * recarrega lista + contadores. */
  function aoConcluir(atualId: string) {
    const prox = proximaNova(atualId)
    setSelecionada(prox)
    if (!prox) setMobileAberto(false)
    void carregar()
    void carregarSaude()
  }

  /** Após reabrir no detalhe: recarrega lista + contadores, mantém a seleção. */
  function aoReabrir() {
    void carregar()
    void carregarSaude()
  }

  /** Abre o detalhe: seleciona (painel inline no desktop) e, no mobile, o overlay. */
  function abrir(id: string) {
    setSelecionada(id)
    setMobileAberto(true)
  }

  /** Concluir direto da listagem: marca como tratada (sem tarefa) e recarrega. */
  async function concluirNaLista(id: string) {
    if (!confirm('Concluir esta publicação? Ela será marcada como TRATADA e sai da fila de não tratadas.')) return
    setConcluindo(id)
    try {
      const r = await fetch(`/api/publicacoes/${id}/triar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ acao: 'tratar' }),
      })
      const d = await r.json().catch(() => ({}))
      if (!r.ok) { toastError('Não foi possível concluir', d.error ?? 'Tente novamente.'); return }
      success('Publicação concluída', 'Marcada como tratada.')
      // Se a concluída estava selecionada, avança para a próxima não tratada.
      setSelecionada((prev) => (prev === id ? proximaNova(id) : prev))
      await carregar()
      await carregarSaude()
    } finally {
      setConcluindo(null)
    }
  }

  /** Reabrir da listagem: volta para 'não tratada' (mantém a tarefa criada, se houver). */
  async function reabrirNaLista(id: string) {
    if (!confirm('Reabrir esta publicação? Ela volta para NÃO TRATADA. Uma tarefa já criada no Kanban permanece.')) return
    setConcluindo(id)
    try {
      const r = await fetch(`/api/publicacoes/${id}/triar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ acao: 'reabrir' }),
      })
      const d = await r.json().catch(() => ({}))
      if (!r.ok) { toastError('Não foi possível reabrir', d.error ?? 'Tente novamente.'); return }
      success('Publicação reaberta', 'Voltou para não tratada.')
      await carregar()
      await carregarSaude()
    } finally {
      setConcluindo(null)
    }
  }

  const hoje = hojeSaoPaulo()
  const contadores = saude?.contadores
  const temFiltro =
    status !== '' || statusIn !== '' || tribunal !== '' || oab !== '' ||
    de !== '' || ate !== '' || triadaEm !== '' || tipo !== '' || qDebounced !== ''

  // Estado ativo de cada tile face aos filtros correntes (LÓGICA PRESERVADA).
  const semData = de === '' && ate === ''
  const semRecorteTratada = statusIn === '' && triadaEm === ''
  const ativoNaoTratadasHoje =
    status === 'nova' && de === hoje && ate === hoje && semRecorteTratada
  const ativoTratadasHoje = statusIn === 'triada,tarefa_criada' && triadaEm === hoje
  const ativoDescartadasHoje =
    status === 'descartada' && triadaEm === hoje && statusIn === ''
  const ativoNaoTratadasTotal = status === 'nova' && semData && semRecorteTratada

  // Lista da página (servidor já filtrou por tipo e ordenou). A prioridade vem
  // pronta do payload; se faltar (payload antigo), deriva no cliente.
  const listaBruta = dados?.publicacoes ?? []
  const itens = listaBruta.map((p) => ({
    p,
    prioridade:
      p.prioridade ??
      prioridadeDaPublicacao({
        tipo_documento: p.tipo_documento,
        tipo_comunicacao: p.tipo_comunicacao,
        texto: p.trecho,
      }),
  }))
  const totalPaginas = dados?.totalPaginas ?? 1
  const totalGeral = dados?.total ?? 0
  // Partes do item selecionado (o detalhe não devolve `partes`; passamos como fallback).
  const partesSelecionada = listaBruta.find((p) => p.id === selecionada)?.partes ?? null

  return (
    <div className="space-y-4">
      {/* ALERTA DE CAPTURA (período de comparação com o Astrea): a última rodada
          de alguma OAB falhou/ficou parcial → ciência EXPLÍCITA ao entrar na tela.
          Os diários podem estar incompletos até a recuperação. */}
      {saude?.alertas && saude.alertas.length > 0 && (
        <div
          role="alert"
          className="rounded-xl border border-destructive/50 bg-destructive/10 p-4"
        >
          <p className="flex items-center gap-2 font-bold text-destructive">
            <AlertTriangle className="h-5 w-5 shrink-0" aria-hidden />
            Alerta: falha na captura de publicações — os diários podem estar incompletos
          </p>
          <ul className="mt-2 space-y-0.5 text-sm text-destructive/90">
            {saude.alertas.map((a) => (
              <li key={`${a.oab}-${a.uf}`}>
                OAB {a.oab}/{a.uf}: {a.status === 'parcial' ? 'cobertura parcial da janela' : (a.erro || 'falha na consulta ao DJEN')}
                {a.quando ? ` · ${formatarDataHora(a.quando)}` : ''}
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-destructive/80">
            Enquanto isso, confira as publicações no Astrea. A recuperação é automática na
            próxima captura (a janela não coberta é refeita); se o alerta persistir por mais
            de um dia, acione o suporte para reprocessar.
          </p>
        </div>
      )}

      {/* SENTINELA DataJud × DJEN — movimentos que implicam publicação no diário
          sem comunicação correspondente no DJEN (possível falha de envio pelo
          tribunal). Triagem interna: nunca calcula prazo, nunca avisa cliente. */}
      <SentinelaPanel alertas={sentinela} onRecarregar={() => void carregarSentinela()} />

      {/* Barra de SAÚDE (health + chips por OAB) */}
      <SaudeWidget dados={saude} loading={loadingSaude} />

      {/* 4 TILES de contadores — clique aplica o filtro (LÓGICA PRESERVADA). */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Tile
          rotulo="Não tratadas de hoje"
          valor={contadores?.naoTratadasHoje}
          destaque
          ativo={ativoNaoTratadasHoje}
          onClick={() => aplicarFiltro({ status: 'nova', statusIn: '', de: hoje, ate: hoje, triadaEm: '' })}
        />
        <Tile
          rotulo="Tratadas hoje"
          valor={contadores?.tratadasHoje}
          ativo={ativoTratadasHoje}
          onClick={() => aplicarFiltro({ status: '', statusIn: 'triada,tarefa_criada', de: '', ate: '', triadaEm: hoje })}
        />
        <Tile
          rotulo="Descartadas hoje"
          valor={contadores?.descartadasHoje}
          ativo={ativoDescartadasHoje}
          onClick={() => aplicarFiltro({ status: 'descartada', statusIn: '', de: '', ate: '', triadaEm: hoje })}
        />
        <Tile
          rotulo="Não tratadas (total)"
          valor={contadores?.naoTratadasTotal}
          ativo={ativoNaoTratadasTotal}
          onClick={() => aplicarFiltro({ status: 'nova', statusIn: '', de: '', ate: '', triadaEm: '' })}
        />
      </div>

      {/* FILTROS */}
      <div className="rounded-xl border border-border bg-card p-4 shadow-card">
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-[200px] flex-1">
            <Input
              placeholder="Buscar por processo, parte, cliente ou palavra…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              leftIcon={<Search className="h-4 w-4" />}
              aria-label="Buscar publicações"
            />
          </div>
          <div className="w-40">
            <Input
              type="date"
              aria-label="Período — de"
              value={de}
              onChange={(e) => { setDe(e.target.value); setTriadaEm(''); setStatusIn(''); setPage(1) }}
            />
          </div>
          <div className="w-40">
            <Input
              type="date"
              aria-label="Período — até"
              value={ate}
              onChange={(e) => { setAte(e.target.value); setTriadaEm(''); setStatusIn(''); setPage(1) }}
            />
          </div>
          <div className="w-44">
            <Select
              aria-label="Status"
              value={status}
              onChange={(e) => {
                // Escolher um status único descarta os recortes só-de-tile
                // (união e `triada_em`) para não misturar filtros conflitantes.
                setStatus(e.target.value)
                setStatusIn('')
                setTriadaEm('')
                setPage(1)
              }}
              options={STATUS_OPCOES}
            />
          </div>
          <div className="w-40">
            <Select
              aria-label="Tribunal"
              value={tribunal}
              onChange={(e) => { setTribunal(e.target.value); setPage(1) }}
              options={[
                { value: '', label: 'Todos os tribunais' },
                ...tribunais.map((t) => ({ value: t, label: t })),
              ]}
            />
          </div>
          <div className="w-40">
            <Select
              aria-label="OAB"
              value={oab}
              onChange={(e) => { setOab(e.target.value); setPage(1) }}
              options={[
                { value: '', label: 'Todas as OABs' },
                ...oabs.map((o) => ({ value: o.num, label: o.uf ? `${o.num}/${o.uf}` : o.num })),
              ]}
            />
          </div>
          <div className="w-48">
            <Select
              aria-label="Tipo"
              value={tipo}
              onChange={(e) => { setTipo(e.target.value); setPage(1) }}
              options={[
                { value: '', label: 'Todos os tipos' },
                ...tipos.map((t) => ({ value: t, label: t })),
              ]}
            />
          </div>

          {/* Toggle de densidade */}
          <div className="inline-flex overflow-hidden rounded-md border border-border" role="group" aria-label="Densidade da lista">
            <DensidadeBtn
              ativo={densidade === 'confortavel'}
              onClick={() => mudarDensidade('confortavel')}
              icon={<LayoutList className="h-4 w-4" />}
              rotulo="Confortável"
            />
            <DensidadeBtn
              ativo={densidade === 'compacto'}
              onClick={() => mudarDensidade('compacto')}
              icon={<AlignJustify className="h-4 w-4" />}
              rotulo="Compacto"
            />
          </div>

          {temFiltro && (
            <Button variant="ghost" size="sm" onClick={limpar}>
              <X className="h-4 w-4" /> Limpar
            </Button>
          )}
        </div>
      </div>

      {/* CORPO — master-detail */}
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
        {/* ESQUERDA — lista de cards */}
        <div className="min-w-0 space-y-3">
          <div className="flex items-center justify-between gap-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {loading && !dados ? 'Carregando…' : `${totalGeral} publicaç${totalGeral === 1 ? 'ão' : 'ões'}`}
            </p>
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">Ordenar por</span>
              <select
                aria-label="Ordenar por"
                value={ordenar}
                onChange={(e) => { setOrdenar(e.target.value); setPage(1) }}
                className="h-8 cursor-pointer rounded-md border border-input bg-background px-2 text-xs text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {ORDENAR_OPCOES.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </div>
          </div>

          {loading && !dados ? (
            <div className="flex items-center gap-2 py-10 text-sm text-muted-foreground">
              <Spinner className="h-4 w-4" /> Carregando publicações…
            </div>
          ) : itens.length === 0 ? (
            <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border bg-card px-6 py-14 text-center">
              <Newspaper className="h-8 w-8 text-muted-foreground" aria-hidden />
              <p className="mt-3 text-sm font-medium text-foreground">
                {temFiltro ? 'Nenhuma publicação encontrada' : 'Nenhuma publicação na caixa'}
              </p>
              <p className="mt-1 max-w-sm text-sm text-muted-foreground">
                {temFiltro
                  ? 'Ajuste os filtros ou limpe a busca para ver mais resultados.'
                  : 'As publicações capturadas do DJEN por OAB aparecem aqui para tratamento.'}
              </p>
            </div>
          ) : (
            <>
              <ul className="space-y-2.5">
                {itens.map(({ p, prioridade }) => (
                  <li key={p.id}>
                    <CardPublicacao
                      pub={p}
                      prioridade={prioridade}
                      densidade={densidade}
                      selecionado={selecionada === p.id}
                      ocupada={concluindo === p.id}
                      onAbrir={() => abrir(p.id)}
                      onConcluir={() => concluirNaLista(p.id)}
                      onReabrir={() => reabrirNaLista(p.id)}
                    />
                  </li>
                ))}
              </ul>

              {/* Paginação */}
              <div className="flex items-center justify-between pt-1">
                <p className="text-xs text-muted-foreground">
                  Página {dados?.pagina ?? page} de {totalPaginas}
                </p>
                <div className="flex items-center gap-2">
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={page <= 1 || loading}
                    onClick={() => setPage((n) => Math.max(1, n - 1))}
                  >
                    <ChevronLeft className="h-4 w-4" /> Anterior
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={page >= totalPaginas || loading}
                    onClick={() => setPage((n) => n + 1)}
                  >
                    Próxima <ChevronRight className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </>
          )}
        </div>

        {/* DIREITA — detalhe sempre visível (lg+); no mobile vira overlay. */}
        <div className="hidden lg:block">
          <div className="lg:sticky lg:top-0 lg:h-[calc(100vh-7rem)]">
            {selecionada && desktop ? (
              <PainelDetalhe
                key={selecionada}
                id={selecionada}
                teamMembers={teamMembers}
                partesFallback={partesSelecionada}
                modo="inline"
                onConcluido={aoConcluir}
                onReaberto={aoReabrir}
              />
            ) : (
              <div className="flex h-full flex-col items-center justify-center rounded-xl border border-dashed border-border bg-card px-6 text-center">
                <Inbox className="h-9 w-9 text-muted-foreground" aria-hidden />
                <p className="mt-3 text-sm font-medium text-foreground">Selecione uma publicação</p>
                <p className="mt-1 max-w-xs text-sm text-muted-foreground">
                  Escolha um item à esquerda para ler o inteiro teor e tratar sem sair da tela.
                </p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Overlay de detalhe no mobile (< lg) */}
      {!desktop && mobileAberto && selecionada && (
        <PainelDetalhe
          key={`overlay-${selecionada}`}
          id={selecionada}
          teamMembers={teamMembers}
          partesFallback={partesSelecionada}
          modo="overlay"
          onFechar={() => setMobileAberto(false)}
          onConcluido={aoConcluir}
          onReaberto={aoReabrir}
        />
      )}
    </div>
  )
}

/** Tile de contador clicável (número grande + rótulo pequeno em maiúsculas). */
function Tile({
  rotulo,
  valor,
  destaque,
  ativo,
  onClick,
}: {
  rotulo: string
  valor: number | undefined
  destaque?: boolean
  ativo?: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={ativo}
      className={cn(
        'flex flex-col items-start rounded-xl border bg-card px-4 py-3 text-left shadow-card transition-colors',
        'hover:border-ring focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        destaque && 'border-warning/40 bg-warning/5',
        ativo && 'ring-2 ring-ring',
      )}
    >
      <span
        className={cn(
          'text-2xl font-bold tabular-nums leading-none',
          destaque ? 'text-warning' : 'text-foreground',
        )}
      >
        {valor ?? '—'}
      </span>
      <span className="mt-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {rotulo}
      </span>
    </button>
  )
}

function DensidadeBtn({
  ativo,
  onClick,
  icon,
  rotulo,
}: {
  ativo: boolean
  onClick: () => void
  icon: ReactNode
  rotulo: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={ativo}
      title={rotulo}
      className={cn(
        'inline-flex h-11 items-center gap-1.5 px-3 text-sm font-medium transition-colors',
        ativo ? 'bg-muted text-foreground' : 'bg-background text-muted-foreground hover:bg-muted/50',
      )}
    >
      {icon}
      <span className="hidden sm:inline">{rotulo}</span>
    </button>
  )
}

/** Tag neutra derivada (tipo/tribunal) — NUNCA prazo. */
function Tag({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex items-center rounded-md bg-muted/60 px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground">
      {children}
    </span>
  )
}

/** Card de uma publicação (substitui a linha de tabela) — master-detail. */
function CardPublicacao({
  pub,
  prioridade,
  densidade,
  selecionado,
  ocupada,
  onAbrir,
  onConcluir,
  onReabrir,
}: {
  pub: PublicacaoListItem
  prioridade: PrioridadeHint
  densidade: Densidade
  selecionado: boolean
  ocupada: boolean
  onAbrir: () => void
  onConcluir: () => void
  onReabrir: () => void
}) {
  const tipo = pub.tipo_documento || pub.tipo_comunicacao
  const naoTratada = pub.status === 'nova'
  const numero = pub.numero_mascara || pub.numero_processo
  const pv = pub.processoVinculado
  const compacto = densidade === 'compacto'

  // "TRIBUNAL · órgão" (a DATA sai desta linha apagada: ganhou destaque próprio
  // na linha 1 do card, a pedido do dono — é o 1º critério de triagem).
  const meta = [pub.sigla_tribunal, pub.orgao_julgador].filter(Boolean).join(' · ')
  // DIVULGAÇÃO em destaque (a lista ordena por ela — dá mais tempo ao escritório);
  // PUBLICAÇÃO (presumida) ao lado, como no Astrea. Nunca calculamos prazo.
  const dataDivulgacao = formatarData(pub.data_disponibilizacao)
  const dataPublicacao = pub.data_publicacao_sugerida ? formatarData(pub.data_publicacao_sugerida) : null

  return (
    <article
      onClick={onAbrir}
      aria-current={selecionado}
      className={cn(
        'cursor-pointer rounded-xl border bg-card shadow-card transition-colors',
        compacto ? 'p-3' : 'p-4',
        selecionado
          ? 'border-primary bg-primary/[0.04] ring-1 ring-primary/40'
          : 'border-border hover:border-ring',
      )}
    >
      <div className="flex items-start gap-3">
        {/* Checkbox de seleção (visual) */}
        <span
          aria-hidden
          className={cn(
            'mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-colors',
            selecionado ? 'border-primary bg-primary text-primary-foreground' : 'border-input',
          )}
        >
          {selecionado && <Check className="h-3 w-3" />}
        </span>

        <div className="min-w-0 flex-1">
          {/* Linha 1: DATAS em destaque (divulgação forte + publicação presumida) +
              prioridade + tipo + status */}
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            {dataDivulgacao && (
              <span
                className="inline-flex shrink-0 items-center gap-1 rounded-md bg-muted px-1.5 py-0.5 text-xs font-bold tabular-nums text-foreground"
                title={`Divulgado em ${dataDivulgacao}`}
              >
                <CalendarDays className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
                {dataDivulgacao}
              </span>
            )}
            {dataPublicacao && (
              <span
                className="shrink-0 text-[11px] tabular-nums text-muted-foreground"
                title="Data de publicação presumida — o prazo é definido por você"
              >
                Publicação: <span className="font-semibold text-foreground/80">{dataPublicacao}</span>
              </span>
            )}
            <PrioridadeBadge nivel={prioridade} />
            {tipo && <span className="truncate text-xs font-medium text-muted-foreground">{tipo}</span>}
            <StatusPill status={pub.status} className="ml-auto shrink-0" />
          </div>

          {/* Linha 2: tribunal · órgão · divulgado */}
          <p className="mt-1.5 truncate text-[11px] uppercase tracking-wide text-muted-foreground" title={meta}>
            {meta}
          </p>

          {/* Título = partes */}
          <h3 className="mt-1.5 truncate font-semibold text-foreground" title={pub.partes ?? undefined}>
            {pub.partes || 'Publicação sem partes identificadas'}
          </h3>
          {numero && <p className="text-xs text-muted-foreground">{numero}</p>}

          {/* Trecho (oculto no modo compacto) */}
          {!compacto && pub.trecho && (
            <p className="mt-1.5 line-clamp-2 text-xs text-muted-foreground/80">{pub.trecho}</p>
          )}

          {/* Rodapé: cliente + tags + ações */}
          <div className="mt-2.5 flex flex-wrap items-center gap-2">
            {pv?.clienteId && pv.clienteNome ? (
              <Link
                href={`/clientes/${pv.clienteId}`}
                onClick={(e) => e.stopPropagation()}
                className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
              >
                <User className="h-3.5 w-3.5" /> {pv.clienteNome}
              </Link>
            ) : pv?.clienteNome ? (
              <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                <User className="h-3.5 w-3.5" /> {pv.clienteNome}
              </span>
            ) : null}

            {!compacto && pub.sigla_tribunal && <Tag>{pub.sigla_tribunal}</Tag>}
            {!compacto && tipo && <Tag>{tipo}</Tag>}

            <div className="ml-auto flex items-center gap-1">
              {naoTratada ? (
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={ocupada}
                  onClick={(e) => { e.stopPropagation(); onConcluir() }}
                  className="h-8 w-8 p-0 text-success"
                  title="Concluir (marcar como tratada)"
                  aria-label="Concluir publicação (marcar como tratada)"
                >
                  {ocupada ? <Spinner className="h-4 w-4" /> : <CheckCircle2 className="h-4 w-4" />}
                </Button>
              ) : (
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={ocupada}
                  onClick={(e) => { e.stopPropagation(); onReabrir() }}
                  className="h-8 w-8 p-0"
                  title="Reabrir (voltar para não tratada)"
                  aria-label="Reabrir publicação (voltar para não tratada)"
                >
                  {ocupada ? <Spinner className="h-4 w-4" /> : <RotateCcw className="h-4 w-4" />}
                </Button>
              )}
              <Button
                variant="ghost"
                size="sm"
                onClick={(e) => { e.stopPropagation(); onAbrir() }}
                className="h-8 w-8 p-0"
                title="Abrir publicação"
                aria-label={`Abrir publicação ${numero || ''}`.trim()}
              >
                <ArrowRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </div>
      </div>
    </article>
  )
}
