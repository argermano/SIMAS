'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Spinner } from '@/components/ui/spinner'
import { EmptyState } from '@/components/ui/empty-state'
import { cn, formatarData } from '@/lib/utils'
import { Search, X, ChevronLeft, ChevronRight, Newspaper, FileText, ArrowRight, User, CheckCircle2, RotateCcw } from 'lucide-react'
import { useToast } from '@/components/ui/toast'
import { SaudeWidget } from './SaudeWidget'
import { PublicacaoDrawer } from './PublicacaoDrawer'
import {
  STATUS_META,
  hojeSaoPaulo,
  type PublicacaoListItem,
  type PublicacaoStatus,
  type SaudePublicacoes,
  type TeamMember,
} from './tipos'

const STATUS_OPCOES = [
  { value: '', label: 'Todas' },
  { value: 'nova', label: 'Não tratadas' },
  { value: 'triada', label: 'Tratadas (sem tarefa)' },
  { value: 'tarefa_criada', label: 'Tratadas (com tarefa)' },
  { value: 'descartada', label: 'Descartadas' },
]

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

  const [dados, setDados] = useState<Resposta | null>(null)
  const [loading, setLoading] = useState(true)
  const [tribunais, setTribunais] = useState<string[]>([]) // acumula siglas vistas
  const [oabs, setOabs] = useState<{ num: string; uf: string }[]>([]) // acumula OABs vistas
  const [selecionada, setSelecionada] = useState<string | null>(null)

  const [saude, setSaude] = useState<SaudePublicacoes | null>(null)
  const [loadingSaude, setLoadingSaude] = useState(true)

  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined)
  // Snapshot mais recente da lista, para a fila "próxima não tratada" avançar
  // sem depender do fechamento (closure) do callback.
  const listaRef = useRef<PublicacaoListItem[]>([])

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
      if (de) params.set('de', de)
      if (ate) params.set('ate', ate)
      if (triadaEm) params.set('triadaEm', triadaEm)
      if (qDebounced) params.set('q', qDebounced)
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
      }
    } finally {
      setLoading(false)
    }
  }, [status, statusIn, tribunal, oab, de, ate, triadaEm, qDebounced, page])

  const carregarSaude = useCallback(async () => {
    setLoadingSaude(true)
    try {
      const r = await fetch('/api/publicacoes/saude')
      if (r.ok) setSaude((await r.json()) as SaudePublicacoes)
    } finally {
      setLoadingSaude(false)
    }
  }, [])

  useEffect(() => { void carregar() }, [carregar])
  useEffect(() => { void carregarSaude() }, [carregarSaude])

  function limpar() {
    setStatus('')
    setStatusIn('')
    setTribunal('')
    setOab('')
    setDe('')
    setAte('')
    setTriadaEm('')
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
    setSelecionada(proximaNova(atualId))
    void carregar()
    void carregarSaude()
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
    de !== '' || ate !== '' || triadaEm !== '' || qDebounced !== ''
  const lista = dados?.publicacoes ?? []
  const totalPaginas = dados?.totalPaginas ?? 1

  // Estado ativo de cada tile face aos filtros correntes. Cada tile aplica
  // EXATAMENTE o mesmo recorte que /saude usa para o número, então o clique abre
  // os itens contados: "não tratadas" por status 'nova' (+ data_disponibilizacao
  // = hoje no tile do dia); "tratadas hoje" pela UNIÃO 'triada'+'tarefa_criada'
  // (statusIn) recortada por `triada_em` = hoje; "descartadas hoje" por status
  // 'descartada' recortado por `triada_em` = hoje.
  const semData = de === '' && ate === ''
  const semRecorteTratada = statusIn === '' && triadaEm === ''
  const ativoNaoTratadasHoje =
    status === 'nova' && de === hoje && ate === hoje && semRecorteTratada
  const ativoTratadasHoje = statusIn === 'triada,tarefa_criada' && triadaEm === hoje
  const ativoDescartadasHoje =
    status === 'descartada' && triadaEm === hoje && statusIn === ''
  const ativoNaoTratadasTotal = status === 'nova' && semData && semRecorteTratada

  return (
    <div className="space-y-4">
      {/* Barra de contadores (estilo Astrea) — clique aplica o filtro. */}
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
          rotulo="Não tratadas"
          valor={contadores?.naoTratadasTotal}
          ativo={ativoNaoTratadasTotal}
          onClick={() => aplicarFiltro({ status: 'nova', statusIn: '', de: '', ate: '', triadaEm: '' })}
        />
      </div>

      <SaudeWidget dados={saude} loading={loadingSaude} />

      {/* Filtros */}
      <Card>
        <CardContent className="flex flex-wrap items-end gap-3 py-4">
          <div className="min-w-[180px] flex-1">
            <Input
              placeholder="Buscar por texto ou nº do processo…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              leftIcon={<Search className="h-4 w-4" />}
            />
          </div>
          <div className="w-48">
            <Select
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
              value={oab}
              onChange={(e) => { setOab(e.target.value); setPage(1) }}
              options={[
                { value: '', label: 'Todas as OABs' },
                ...oabs.map((o) => ({ value: o.num, label: o.uf ? `${o.num}/${o.uf}` : o.num })),
              ]}
            />
          </div>
          {temFiltro && (
            <Button variant="ghost" size="sm" onClick={limpar}>
              <X className="h-4 w-4" /> Limpar
            </Button>
          )}
        </CardContent>
      </Card>

      {/* Lista */}
      {loading && !dados ? (
        <div className="flex items-center gap-2 py-10 text-sm text-muted-foreground">
          <Spinner className="h-4 w-4" /> Carregando publicações…
        </div>
      ) : lista.length === 0 ? (
        <Card>
          <EmptyState
            icon={<Newspaper className="h-8 w-8" />}
            title={temFiltro ? 'Nenhuma publicação encontrada' : 'Nenhuma publicação na caixa'}
            description={
              temFiltro
                ? 'Ajuste os filtros ou limpe a busca para ver mais resultados.'
                : 'As publicações capturadas do DJEN por OAB aparecem aqui para tratamento.'
            }
          />
        </Card>
      ) : (
        <>
          {/* Desktop: tabela estilo Astrea — SEM scroll horizontal (table-fixed +
              truncamento); fundo branco no claro, card no escuro. */}
          <div className="hidden overflow-hidden rounded-lg border border-border bg-white md:block dark:bg-card">
            <table className="w-full table-fixed border-collapse text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/30 text-left text-xs uppercase tracking-wide text-muted-foreground dark:bg-muted/40">
                  <th scope="col" className="w-[8rem] px-3 py-2.5 font-medium">Divulgado em</th>
                  <th scope="col" className="w-[8rem] px-3 py-2.5 font-medium">Tipo</th>
                  <th scope="col" className="px-3 py-2.5 font-medium">Processo</th>
                  <th scope="col" className="hidden w-[7rem] px-3 py-2.5 font-medium lg:table-cell">Diário</th>
                  <th scope="col" className="hidden w-[10rem] px-3 py-2.5 font-medium xl:table-cell">Nome pesquisado</th>
                  <th scope="col" className="w-[9rem] px-3 py-2.5 font-medium">Status</th>
                  <th scope="col" className="w-[6rem] px-3 py-2.5 text-right font-medium">Ações</th>
                </tr>
              </thead>
              <tbody>
                {lista.map((p) => (
                  <LinhaTabela
                    key={p.id}
                    pub={p}
                    onAbrir={() => setSelecionada(p.id)}
                    onConcluir={() => concluirNaLista(p.id)}
                    onReabrir={() => reabrirNaLista(p.id)}
                    ocupada={concluindo === p.id}
                  />
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile: cards empilhados */}
          <div className="space-y-2 md:hidden">
            {lista.map((p) => (
              <CardPublicacao
                key={p.id}
                pub={p}
                onAbrir={() => setSelecionada(p.id)}
                onConcluir={() => concluirNaLista(p.id)}
                onReabrir={() => reabrirNaLista(p.id)}
                ocupada={concluindo === p.id}
              />
            ))}
          </div>

          {/* Paginação */}
          <div className="flex items-center justify-between pt-1">
            <p className="text-sm text-muted-foreground">
              {dados ? `${dados.total} publicaç${dados.total === 1 ? 'ão' : 'ões'}` : ''}
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
              <span className="text-sm text-muted-foreground">
                {dados?.pagina ?? page} / {totalPaginas}
              </span>
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

      {selecionada && (
        <PublicacaoDrawer
          id={selecionada}
          teamMembers={teamMembers}
          onClose={() => setSelecionada(null)}
          onConcluido={aoConcluir}
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
        'flex flex-col items-start rounded-lg border bg-card px-4 py-3 text-left transition-colors',
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

/** Nome pesquisado: advogado monitorado que casou; fallback p/ a OAB. */
function nomePesquisado(pub: PublicacaoListItem): string {
  if (pub.advogado) return pub.advogado
  if (!pub.oab_consultada) return '—'
  return `OAB ${pub.oab_consultada}${pub.uf_oab ? '/' + pub.uf_oab : ''}`
}

/** Célula/bloco PROCESSO (estilo Astrea): nº mascarado + as PARTES ("Autor × Réu")
 * em destaque (identidade do caso) + nome do cliente vinculado quando há processo
 * cadastrado no SIMAS. */
function ProcessoCelula({ pub }: { pub: PublicacaoListItem }) {
  const numero = pub.numero_mascara || pub.numero_processo
  const pv = pub.processoVinculado
  return (
    <div className="min-w-0">
      <span className="text-xs text-muted-foreground">{numero || '—'}</span>
      {pub.partes && (
        <span className="mt-0.5 block truncate font-medium text-foreground" title={pub.partes}>
          {pub.partes}
        </span>
      )}
      {pv?.clienteId && pv.clienteNome ? (
        <Link
          href={`/clientes/${pv.clienteId}`}
          onClick={(e) => e.stopPropagation()}
          className="mt-0.5 inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
        >
          <User className="h-3 w-3" /> {pv.clienteNome}
        </Link>
      ) : pv?.clienteNome ? (
        <span className="mt-0.5 block truncate text-xs text-muted-foreground">{pv.clienteNome}</span>
      ) : null}
    </div>
  )
}

/** Duas linhas de tabela por publicação: a linha de colunas + a de trecho.
 * A linha inteira é clicável (conveniência de mouse); o controle acessível de
 * teclado/AT é o botão explícito "Acessar" (evita interativo aninhado no <tr>). */
function LinhaTabela({ pub, onAbrir, onConcluir, onReabrir, ocupada }: {
  pub: PublicacaoListItem; onAbrir: () => void; onConcluir: () => void; onReabrir: () => void; ocupada: boolean
}) {
  const meta = STATUS_META[pub.status as PublicacaoStatus] ?? STATUS_META.nova
  const tipo = pub.tipo_documento || pub.tipo_comunicacao
  const naoTratada = pub.status === 'nova'
  return (
    <>
      <tr
        className="cursor-pointer border-t border-border align-top transition-colors hover:bg-muted/40"
        onClick={onAbrir}
      >
        <td className="px-3 py-2.5">
          <div className="whitespace-nowrap text-foreground">{formatarData(pub.data_disponibilizacao)}</div>
          {pub.data_publicacao_sugerida && (
            <div className="text-xs text-muted-foreground">
              Publicado: {formatarData(pub.data_publicacao_sugerida)}
            </div>
          )}
        </td>
        <td className="px-3 py-2.5">
          <span className="flex items-start gap-1.5 text-foreground">
            <FileText className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
            <span className="min-w-0 break-words">{tipo || '—'}</span>
          </span>
        </td>
        <td className="px-3 py-2.5">
          <ProcessoCelula pub={pub} />
        </td>
        <td className="hidden px-3 py-2.5 lg:table-cell">
          {pub.sigla_tribunal && (
            <span className="inline-block rounded bg-muted/60 px-1.5 py-0.5 text-xs font-medium text-foreground">
              {pub.sigla_tribunal}
            </span>
          )}
          {pub.orgao_julgador && (
            <div className="mt-0.5 truncate text-xs text-muted-foreground" title={pub.orgao_julgador}>
              {pub.orgao_julgador}
            </div>
          )}
          {!pub.sigla_tribunal && !pub.orgao_julgador && <span className="text-muted-foreground">—</span>}
        </td>
        <td className="hidden truncate px-3 py-2.5 text-foreground xl:table-cell" title={nomePesquisado(pub)}>{nomePesquisado(pub)}</td>
        <td className="px-3 py-2.5">
          <StatusPill status={pub.status} label={meta.label} />
        </td>
        <td className="px-3 py-2.5">
          <div className="flex items-center justify-end gap-1">
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
              title="Acessar publicação"
              aria-label={`Acessar publicação ${pub.numero_mascara || pub.numero_processo || ''}`.trim()}
            >
              <ArrowRight className="h-4 w-4" />
            </Button>
          </div>
        </td>
      </tr>
      {pub.trecho && (
        <tr className="cursor-pointer transition-colors hover:bg-muted/40" onClick={onAbrir}>
          <td colSpan={7} className="px-3 pb-3">
            <p className="line-clamp-1 text-xs text-muted-foreground/80">{pub.trecho}</p>
          </td>
        </tr>
      )}
    </>
  )
}

/** Pill de status claro (estilo Astrea) — contraste garantido em qualquer fundo. */
const PILL_CLASSES: Record<PublicacaoStatus, string> = {
  nova:          'bg-warning/15 text-warning ring-1 ring-warning/40',
  triada:        'bg-muted text-muted-foreground ring-1 ring-border',
  tarefa_criada: 'bg-success/15 text-success ring-1 ring-success/40',
  descartada:    'bg-muted text-muted-foreground ring-1 ring-border',
}
function StatusPill({ status, label }: { status: PublicacaoStatus; label: string }) {
  return (
    <span className={cn('inline-block whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-semibold', PILL_CLASSES[status] ?? PILL_CLASSES.nova)}>
      {label}
    </span>
  )
}

/** Card empilhado (mobile) — mesma informação da linha da tabela. */
function CardPublicacao({ pub, onAbrir, onConcluir, onReabrir, ocupada }: {
  pub: PublicacaoListItem; onAbrir: () => void; onConcluir: () => void; onReabrir: () => void; ocupada: boolean
}) {
  const meta = STATUS_META[pub.status as PublicacaoStatus] ?? STATUS_META.nova
  const tipo = pub.tipo_documento || pub.tipo_comunicacao
  const naoTratada = pub.status === 'nova'
  return (
    <Card
      className="cursor-pointer transition-colors hover:border-ring"
      onClick={onAbrir}
    >
      <CardContent className="space-y-2 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <StatusPill status={pub.status} label={meta.label} />
          <span className="text-xs text-muted-foreground">{formatarData(pub.data_disponibilizacao)}</span>
          {pub.sigla_tribunal && (
            <span className="rounded bg-muted/60 px-1.5 py-0.5 text-xs font-medium text-foreground">
              {pub.sigla_tribunal}
            </span>
          )}
          {tipo && (
            <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
              <FileText className="h-3 w-3" aria-hidden /> {tipo}
            </span>
          )}
        </div>
        <ProcessoCelula pub={pub} />
        <p className="text-xs text-muted-foreground">{nomePesquisado(pub)}</p>
        {pub.trecho && (
          <p className="line-clamp-1 text-xs text-muted-foreground/80">{pub.trecho}</p>
        )}
        <div className="flex items-center gap-2">
          {naoTratada ? (
            <Button variant="secondary" size="sm" disabled={ocupada} onClick={(e) => { e.stopPropagation(); onConcluir() }}>
              {ocupada ? <Spinner className="h-4 w-4" /> : <CheckCircle2 className="h-4 w-4" />} Concluir
            </Button>
          ) : (
            <Button variant="ghost" size="sm" disabled={ocupada} onClick={(e) => { e.stopPropagation(); onReabrir() }}>
              {ocupada ? <Spinner className="h-4 w-4" /> : <RotateCcw className="h-4 w-4" />} Reabrir
            </Button>
          )}
          <Button variant="ghost" size="sm" onClick={(e) => { e.stopPropagation(); onAbrir() }}>
            Acessar <ArrowRight className="h-4 w-4" />
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
