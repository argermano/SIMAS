'use client'

import { useCallback, useEffect, useState } from 'react'
import { ChevronLeft, ChevronRight, MessageSquare, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { useToast } from '@/components/ui/toast'
import type { AgenteMe, Conversa, InboxNome, RespostaLista, StatusConversa } from '@/lib/conversas/tipos'
import { metaTemProxima } from '@/lib/conversas/paginacao'
import { ConexaoAgente } from './ConexaoAgente'
import { ListaConversas } from './ListaConversas'
import { Thread } from './Thread'
import { mensagemErroRelay } from './erros'

const STATUS_OPCOES: { value: StatusConversa; label: string }[] = [
  { value: 'open', label: 'Abertas' },
  { value: 'resolved', label: 'Resolvidas' },
]

const INBOX_OPCOES: { value: '' | InboxNome; label: string }[] = [
  { value: '', label: 'Todos' },
  { value: 'DF', label: 'DF' },
  { value: 'SC', label: 'SC' },
]

export function Conversas({ email }: { email: string }) {
  void email // e-mail (auth) é injetado server-side no header X-Simas-User-Email; aqui é só informativo.
  const { error: toastError } = useToast()

  // Filtros
  const [status, setStatus] = useState<StatusConversa>('open')
  const [inbox, setInbox] = useState<'' | InboxNome>('')
  const [page, setPage] = useState(1)

  // Lista
  const [conversas, setConversas] = useState<Conversa[]>([])
  const [meta, setMeta] = useState<unknown>(null)
  const [loading, setLoading] = useState(true)
  const [erroLista, setErroLista] = useState<string | null>(null)
  const [selecionadaId, setSelecionadaId] = useState<number | null>(null)

  // Layout responsivo (um único painel de detalhe montado por vez)
  const [desktop, setDesktop] = useState(true)
  const [mobileAberto, setMobileAberto] = useState(false)

  // Conexão do agente
  const [agente, setAgente] = useState<AgenteMe | null>(null)
  const [loadingAgente, setLoadingAgente] = useState(true)

  // Rastreia o breakpoint lg (1024px).
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 1024px)')
    const upd = () => setDesktop(mq.matches)
    upd()
    mq.addEventListener('change', upd)
    return () => mq.removeEventListener('change', upd)
  }, [])

  const carregar = useCallback(async () => {
    setLoading(true)
    setErroLista(null)
    try {
      const params = new URLSearchParams()
      params.set('status', status)
      if (inbox) params.set('inbox', inbox)
      params.set('page', String(page))
      const r = await fetch(`/api/conversas?${params.toString()}`)
      const d = await r.json().catch(() => ({}))
      if (!r.ok) {
        setErroLista(mensagemErroRelay(r.status, d))
        setConversas([])
        setMeta(null)
        return
      }
      setConversas((d as RespostaLista).conversas ?? [])
      setMeta((d as RespostaLista).meta ?? null)
    } catch {
      setErroLista('Falha de rede ao carregar as conversas.')
      setConversas([])
      setMeta(null)
    } finally {
      setLoading(false)
    }
  }, [status, inbox, page])

  const carregarAgente = useCallback(async () => {
    setLoadingAgente(true)
    try {
      const r = await fetch('/api/conversas/agente')
      const d = await r.json().catch(() => ({ conectado: false }))
      setAgente(r.ok ? (d as AgenteMe) : { conectado: false })
    } catch {
      setAgente({ conectado: false })
    } finally {
      setLoadingAgente(false)
    }
  }, [])

  useEffect(() => {
    void carregar()
  }, [carregar])

  useEffect(() => {
    void carregarAgente()
  }, [carregarAgente])

  function mudarStatus(s: StatusConversa) {
    setStatus(s)
    setPage(1)
    setSelecionadaId(null)
  }

  function mudarInbox(i: '' | InboxNome) {
    setInbox(i)
    setPage(1)
    setSelecionadaId(null)
  }

  function selecionar(id: number) {
    setSelecionadaId(id)
    setMobileAberto(true)
  }

  /** Um envio/ação retornou 428 → agente não está conectado. */
  function marcarDesconectado() {
    setAgente({ conectado: false })
  }

  const selecionada = conversas.find((c) => c.id === selecionadaId) ?? null
  const conectado = agente?.conectado === true

  // Se o meta do relay disser que não há próxima página, desabilita "Próxima".
  // Quando o meta não traz essa info (null), cai no comportamento antigo
  // (baseado só na quantidade de itens da página atual).
  const temProxima = metaTemProxima(meta, page)
  const proximaDesabilitada =
    loading || temProxima === false || (temProxima === null && conversas.length === 0)

  return (
    <div className="space-y-4">
      {/* Banner/estado de conexão da conta */}
      <ConexaoAgente agente={agente} loading={loadingAgente} onMudou={carregarAgente} />

      {/* Filtros */}
      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-card p-3 shadow-card">
        <div className="inline-flex overflow-hidden rounded-md border border-border" role="group" aria-label="Status">
          {STATUS_OPCOES.map((o) => (
            <FiltroBtn key={o.value} ativo={status === o.value} onClick={() => mudarStatus(o.value)}>
              {o.label}
            </FiltroBtn>
          ))}
        </div>

        <div className="inline-flex overflow-hidden rounded-md border border-border" role="group" aria-label="Inbox">
          {INBOX_OPCOES.map((o) => (
            <FiltroBtn key={o.value || 'todos'} ativo={inbox === o.value} onClick={() => mudarInbox(o.value)}>
              {o.label}
            </FiltroBtn>
          ))}
        </div>

        <Button variant="ghost" size="sm" onClick={() => carregar()} className="ml-auto" title="Atualizar lista">
          <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} /> Atualizar
        </Button>
      </div>

      {/* Master-detail */}
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
        {/* ESQUERDA — lista */}
        <div className="min-w-0 space-y-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {loading && conversas.length === 0
              ? 'Carregando…'
              : `${conversas.length} conversa${conversas.length === 1 ? '' : 's'}`}
          </p>

          <ListaConversas
            conversas={conversas}
            loading={loading}
            erro={erroLista}
            selecionadaId={selecionadaId}
            onSelecionar={selecionar}
          />

          {/* Paginação */}
          <div className="flex items-center justify-between pt-1">
            <p className="text-xs text-muted-foreground">Página {page}</p>
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
                disabled={proximaDesabilitada}
                onClick={() => setPage((n) => n + 1)}
              >
                Próxima <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </div>

        {/* DIREITA — detalhe (inline no desktop) */}
        <div className="hidden lg:block">
          <div className="lg:sticky lg:top-0 lg:h-[calc(100vh-7rem)]">
            {selecionada && desktop ? (
              <Thread
                key={selecionada.id}
                conversa={selecionada}
                conectado={conectado}
                modo="inline"
                onListaMudou={carregar}
                onAgenteDesconectado={marcarDesconectado}
              />
            ) : (
              <div className="flex h-full flex-col items-center justify-center rounded-xl border border-dashed border-border bg-card px-6 text-center">
                <MessageSquare className="h-9 w-9 text-muted-foreground" aria-hidden />
                <p className="mt-3 text-sm font-medium text-foreground">Selecione uma conversa</p>
                <p className="mt-1 max-w-xs text-sm text-muted-foreground">
                  Escolha uma conversa à esquerda para ler o histórico e responder sem sair da tela.
                </p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Overlay de detalhe no mobile (< lg) */}
      {!desktop && mobileAberto && selecionada && (
        <Thread
          key={`overlay-${selecionada.id}`}
          conversa={selecionada}
          conectado={conectado}
          modo="overlay"
          onListaMudou={carregar}
          onAgenteDesconectado={marcarDesconectado}
          onFechar={() => setMobileAberto(false)}
        />
      )}
    </div>
  )
}

function FiltroBtn({
  ativo,
  onClick,
  children,
}: {
  ativo: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={ativo}
      className={cn(
        'inline-flex h-9 items-center px-3 text-sm font-medium transition-colors',
        ativo ? 'bg-muted text-foreground' : 'bg-background text-muted-foreground hover:bg-muted/50',
      )}
    >
      {children}
    </button>
  )
}
