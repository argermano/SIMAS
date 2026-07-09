'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Spinner } from '@/components/ui/spinner'
import { EmptyState } from '@/components/ui/empty-state'
import { formatarData } from '@/lib/utils'
import { Search, X, ChevronLeft, ChevronRight, Newspaper, FileText } from 'lucide-react'
import { SaudeWidget } from './SaudeWidget'
import { PublicacaoDrawer } from './PublicacaoDrawer'
import { STATUS_META, type PublicacaoListItem, type PublicacaoStatus, type TeamMember } from './tipos'

const STATUS_OPCOES = [
  { value: '', label: 'Todos os status' },
  { value: 'nova', label: 'Novas' },
  { value: 'triada', label: 'Triadas' },
  { value: 'tarefa_criada', label: 'Com tarefa' },
  { value: 'descartada', label: 'Descartadas' },
]

interface Resposta {
  publicacoes: PublicacaoListItem[]
  total: number
  pagina: number
  totalPaginas: number
}

export function CaixaPublicacoes({ teamMembers }: { teamMembers: TeamMember[] }) {
  const [status, setStatus] = useState('nova')
  const [tribunal, setTribunal] = useState('')
  const [oab, setOab] = useState('')
  const [q, setQ] = useState('')
  const [qDebounced, setQDebounced] = useState('')
  const [page, setPage] = useState(1)

  const [dados, setDados] = useState<Resposta | null>(null)
  const [loading, setLoading] = useState(true)
  const [tribunais, setTribunais] = useState<string[]>([]) // acumula siglas vistas
  const [oabs, setOabs] = useState<{ num: string; uf: string }[]>([]) // acumula OABs vistas
  const [selecionada, setSelecionada] = useState<string | null>(null)
  const [novas, setNovas] = useState(0)

  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined)

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
      if (status) params.set('status', status)
      if (tribunal) params.set('tribunal', tribunal)
      if (oab) params.set('oab', oab)
      if (qDebounced) params.set('q', qDebounced)
      params.set('page', String(page))
      const r = await fetch(`/api/publicacoes?${params.toString()}`)
      if (r.ok) {
        const d: Resposta = await r.json()
        setDados(d)
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
  }, [status, tribunal, oab, qDebounced, page])

  useEffect(() => { void carregar() }, [carregar])

  function limpar() {
    setStatus('')
    setTribunal('')
    setOab('')
    setQ('')
    setQDebounced('')
    setPage(1)
  }

  const temFiltro = status !== '' || tribunal !== '' || oab !== '' || qDebounced !== ''
  const lista = dados?.publicacoes ?? []
  const totalPaginas = dados?.totalPaginas ?? 1

  return (
    <div className="space-y-4">
      <SaudeWidget onNovas={setNovas} />

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
          <div className="w-44">
            <Select
              value={status}
              onChange={(e) => { setStatus(e.target.value); setPage(1) }}
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
                : 'As publicações capturadas do DJEN por OAB aparecem aqui para triagem.'
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
              {novas > 0 && <span className="ml-2 text-warning">· {novas} nova{novas > 1 ? 's' : ''}</span>}
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
          onAlterada={carregar}
        />
      )}
    </div>
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
