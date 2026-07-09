'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Spinner } from '@/components/ui/spinner'
import { EmptyState } from '@/components/ui/empty-state'
import { cn, formatarData } from '@/lib/utils'
import { Search, X, ChevronLeft, ChevronRight, Newspaper, FileText } from 'lucide-react'
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
          <div className="space-y-2">
            {lista.map((p) => (
              <LinhaPublicacao key={p.id} pub={p} onClick={() => setSelecionada(p.id)} />
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

function LinhaPublicacao({ pub, onClick }: { pub: PublicacaoListItem; onClick: () => void }) {
  const meta = STATUS_META[pub.status as PublicacaoStatus] ?? STATUS_META.nova
  return (
    <Card
      className="cursor-pointer transition-colors hover:border-ring"
      onClick={onClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick() } }}
    >
      <CardContent className="py-3">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={meta.variant}>{meta.label}</Badge>
          <span className="text-xs text-muted-foreground">{formatarData(pub.data_disponibilizacao)}</span>
          {pub.sigla_tribunal && (
            <span className="rounded bg-muted/50 px-1.5 py-0.5 text-xs font-medium text-muted-foreground">
              {pub.sigla_tribunal}
            </span>
          )}
          {pub.tipo_documento && (
            <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
              <FileText className="h-3 w-3" /> {pub.tipo_documento}
            </span>
          )}
          <span className="ml-auto text-xs font-medium text-foreground">
            {pub.numero_mascara || pub.numero_processo || 'Sem número'}
          </span>
        </div>
        {pub.trecho && (
          <p className="mt-1.5 line-clamp-2 text-sm text-muted-foreground">{pub.trecho}</p>
        )}
      </CardContent>
    </Card>
  )
}
