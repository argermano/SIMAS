'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { Card, CardContent } from '@/components/ui/card'
import { cn, formatarData } from '@/lib/utils'
import { Search, X, Loader2, Briefcase, Lock, Tag, AlertTriangle, ChevronRight } from 'lucide-react'

// Lista global de atendimentos/casos (GET /api/atendimentos). Busca com debounce,
// chips de status/estágio e "Carregar mais". Clique na linha abre a Casa do caso.

interface AtendimentoItem {
  id: string
  titulo: string | null
  estagio: 'atendimento' | 'caso'
  status: string
  etiquetas: string[]
  created_at: string
  encerrado_em: string | null
  cliente: { id: string; nome: string; pre_cadastro: boolean } | null
}

type Status = 'andamento' | 'encerrados'
type EstagioFiltro = '' | 'atendimento' | 'caso'

function Chip({ ativo, onClick, children }: { ativo: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'shrink-0 rounded-full px-3 py-1 text-sm font-medium transition-colors',
        ativo ? 'bg-primary text-white' : 'bg-muted text-muted-foreground hover:bg-muted/70',
      )}
    >
      {children}
    </button>
  )
}

export function AtendimentosClient() {
  const router = useRouter()

  const [q, setQ] = useState('')
  const [qDebounced, setQDebounced] = useState('')
  const [status, setStatus] = useState<Status>('andamento')
  const [estagio, setEstagio] = useState<EstagioFiltro>('')

  const [items, setItems] = useState<AtendimentoItem[]>([])
  const [total, setTotal] = useState(0)
  const [pagina, setPagina] = useState(1)
  const [carregando, setCarregando] = useState(true)
  const reqSeq = useRef(0) // ordem das requisições: descarta resposta que chegar fora de ordem

  // Debounce da busca (~300ms).
  useEffect(() => {
    const t = setTimeout(() => setQDebounced(q), 300)
    return () => clearTimeout(t)
  }, [q])

  const carregar = useCallback(async (page: number, replace: boolean) => {
    const seq = ++reqSeq.current
    setCarregando(true)
    try {
      const params = new URLSearchParams({ status, page: String(page) })
      if (estagio) params.set('estagio', estagio)
      const termo = qDebounced.trim()
      if (termo.length >= 2) params.set('q', termo)
      const r = await fetch(`/api/atendimentos?${params}`)
      const d = await r.json().catch(() => ({}))
      if (seq !== reqSeq.current) return // saiu uma busca mais nova: ignora esta resposta obsoleta
      if (!r.ok) return
      const novos = (d.atendimentos ?? []) as AtendimentoItem[]
      setItems(prev => (replace ? novos : [...prev, ...novos]))
      setTotal(d.total ?? 0)
      setPagina(page)
    } finally {
      if (seq === reqSeq.current) setCarregando(false)
    }
  }, [status, estagio, qDebounced])

  // Refaz a partir da página 1 sempre que busca/filtros mudam.
  useEffect(() => { carregar(1, true) }, [carregar])

  const podeCarregarMais = items.length < total

  return (
    <div className="space-y-4">
      {/* Busca */}
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground" />
        <input
          type="search"
          value={q}
          onChange={e => setQ(e.target.value)}
          placeholder="Buscar por assunto ou cliente…"
          className="h-11 w-full rounded-md border border-border bg-card py-2 pl-10 pr-10 text-base placeholder:text-muted-foreground focus:border-transparent focus:outline-none focus:ring-2 focus:ring-ring hover:border-muted-foreground transition-colors"
          aria-label="Buscar atendimentos"
        />
        {q && (
          <button
            type="button"
            onClick={() => setQ('')}
            className="absolute right-3 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted-foreground hover:text-foreground"
            aria-label="Limpar busca"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      {/* Filtros: status + estágio */}
      <div className="flex flex-wrap items-center gap-2">
        <Chip ativo={status === 'andamento'} onClick={() => setStatus('andamento')}>Em andamento</Chip>
        <Chip ativo={status === 'encerrados'} onClick={() => setStatus('encerrados')}>Encerrados</Chip>
        <span className="mx-1 h-5 w-px bg-border" />
        <Chip ativo={estagio === ''} onClick={() => setEstagio('')}>Todos</Chip>
        <Chip ativo={estagio === 'atendimento'} onClick={() => setEstagio('atendimento')}>Atendimentos</Chip>
        <Chip ativo={estagio === 'caso'} onClick={() => setEstagio('caso')}>Casos</Chip>
      </div>

      {/* Lista */}
      {carregando && items.length === 0 ? (
        <div className="flex items-center justify-center py-16 text-muted-foreground">
          <Loader2 className="h-6 w-6 animate-spin" />
        </div>
      ) : items.length === 0 ? (
        <EmptyState
          icon={<Briefcase className="h-10 w-10" />}
          title={qDebounced.trim().length >= 2 ? 'Nenhum atendimento encontrado' : 'Nenhum atendimento'}
          description={
            qDebounced.trim().length >= 2
              ? `Nada corresponde a "${qDebounced.trim()}". Tente outro termo.`
              : status === 'encerrados'
                ? 'Nenhum atendimento encerrado por aqui.'
                : 'Crie o primeiro atendimento com "Novo atendimento".'
          }
        />
      ) : (
        <>
          <div className="space-y-2">
            {items.map(a => {
              const titulo = (a.titulo ?? '').trim() || (a.estagio === 'atendimento' ? 'Atendimento' : 'Caso')
              const href = a.cliente ? `/clientes/${a.cliente.id}/casos/${a.id}` : null
              return (
                <Card
                  key={a.id}
                  role={href ? 'button' : undefined}
                  tabIndex={href ? 0 : undefined}
                  onClick={href ? () => router.push(href) : undefined}
                  onKeyDown={href ? (e) => { if (e.key === 'Enter') router.push(href) } : undefined}
                  className={cn('transition-shadow', href && 'cursor-pointer hover:shadow-card-hover')}
                >
                  <CardContent className="flex items-center gap-4 py-4">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                      <Briefcase className="h-5 w-5" />
                    </div>

                    <div className="min-w-0 flex-1">
                      <p className="truncate text-base font-semibold text-foreground">{titulo}</p>

                      <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-sm text-muted-foreground">
                        {a.cliente ? (
                          <Link
                            href={`/clientes/${a.cliente.id}`}
                            onClick={e => e.stopPropagation()}
                            className="font-medium text-foreground hover:text-primary hover:underline"
                          >
                            {a.cliente.nome || 'Cliente'}
                          </Link>
                        ) : (
                          <span className="italic">Sem cliente</span>
                        )}
                        <span className="text-muted-foreground">· {formatarData(a.created_at)}</span>
                      </div>

                      {/* Badges: estágio, encerrado, cadastro incompleto, etiquetas */}
                      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                        <Badge variant={a.estagio === 'atendimento' ? 'default' : 'secondary'} className="gap-1 px-2 py-0.5 text-xs">
                          <Briefcase className="h-3 w-3" /> {a.estagio === 'atendimento' ? 'Atendimento' : 'Caso'}
                        </Badge>
                        {a.encerrado_em && (
                          <Badge variant="success" className="gap-1 px-2 py-0.5 text-xs">
                            <Lock className="h-3 w-3" /> Encerrado
                          </Badge>
                        )}
                        {a.cliente?.pre_cadastro && (
                          <Link
                            href={`/clientes/${a.cliente.id}`}
                            onClick={e => e.stopPropagation()}
                            className="inline-flex items-center gap-1 rounded-full bg-warning/10 px-2 py-0.5 text-xs font-medium text-warning hover:bg-warning/20 transition-colors"
                            title="Cadastro do cliente incompleto — completar dossiê"
                          >
                            <AlertTriangle className="h-3 w-3" /> Cadastro incompleto
                          </Link>
                        )}
                        {a.etiquetas.map(et => (
                          <Badge key={et} variant="secondary" className="gap-1 px-2 py-0.5 text-xs">
                            <Tag className="h-3 w-3" /> {et}
                          </Badge>
                        ))}
                      </div>
                    </div>

                    {href && <ChevronRight className="h-5 w-5 shrink-0 text-muted-foreground" />}
                  </CardContent>
                </Card>
              )
            })}
          </div>

          {/* Paginação incremental */}
          {podeCarregarMais && (
            <div className="flex justify-center pt-1">
              <Button variant="secondary" size="md" onClick={() => carregar(pagina + 1, false)} loading={carregando}>
                Carregar mais
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  )
}
