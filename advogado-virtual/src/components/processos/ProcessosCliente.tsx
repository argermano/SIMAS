'use client'

import { useCallback, useEffect, useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Spinner } from '@/components/ui/spinner'
import { useToast } from '@/components/ui/toast'
import { formatarData, formatarDataRelativa, cn } from '@/lib/utils'
import {
  Scale, Plus, RefreshCw, Trash2, ChevronDown, ChevronRight,
  Archive, RotateCcw, Landmark, FlaskConical, BellRing,
} from 'lucide-react'

type ModoAviso = 'desligado' | 'fila' | 'automatico'

interface Processo {
  id: string
  numero_cnj: string
  tribunal_alias: string
  classe: string | null
  orgao_julgador: string | null
  grau: string | null
  situacao: 'ativo' | 'encerrado'
  apelido: string | null
  ultima_sincronizacao: string | null
  created_at: string
}

interface Movimento {
  id: string
  codigo: number | null
  nome: string
  data_hora: string | null
  resumo_ia: string | null
  categoria: string | null
}

const CATEGORIA_BADGE: Record<string, { label: string; variant: 'success' | 'warning' | 'secondary' | 'default' | 'accent' | 'danger' }> = {
  sentenca:          { label: 'Sentença',        variant: 'success' },
  transito_julgado:  { label: 'Trânsito julgado', variant: 'success' },
  audiencia:         { label: 'Audiência',       variant: 'accent'  },
  expedicao_alvara:  { label: 'Alvará',          variant: 'success' },
  recurso:           { label: 'Recurso',         variant: 'warning' },
  arquivamento:      { label: 'Arquivamento',    variant: 'secondary' },
  decisao_despacho:  { label: 'Decisão/Despacho', variant: 'default' },
  redistribuicao:    { label: 'Redistribuição',  variant: 'secondary' },
  movimentacao_comum: { label: 'Movimentação',   variant: 'secondary' },
}

/** Formata 20 dígitos → NNNNNNN-DD.AAAA.J.TR.OOOO */
function formatarCNJ(d: string): string {
  const s = d.replace(/\D/g, '')
  if (s.length !== 20) return d
  return `${s.slice(0, 7)}-${s.slice(7, 9)}.${s.slice(9, 13)}.${s.slice(13, 14)}.${s.slice(14, 16)}.${s.slice(16, 20)}`
}

export function ProcessosCliente({
  clienteId,
  avisoInicial = 'desligado',
  podeGerenciar = false,
}: {
  clienteId: string
  avisoInicial?: ModoAviso
  podeGerenciar?: boolean
}) {
  const { success, error: toastError } = useToast()
  const [processos, setProcessos] = useState<Processo[]>([])
  const [loading, setLoading] = useState(true)
  const [mostrarForm, setMostrarForm] = useState(false)
  const [numero, setNumero] = useState('')
  const [apelido, setApelido] = useState('')
  const [salvando, setSalvando] = useState(false)
  const [expandido, setExpandido] = useState<string | null>(null)
  const [timeline, setTimeline] = useState<Record<string, Movimento[]>>({})
  const [carregandoTl, setCarregandoTl] = useState<string | null>(null)
  const [ocupado, setOcupado] = useState<string | null>(null)
  const [aviso, setAviso] = useState<ModoAviso>(avisoInicial)

  async function salvarAviso(novo: ModoAviso) {
    const anterior = aviso
    setAviso(novo)
    const r = await fetch(`/api/clientes/${clienteId}/aviso-movimentacao`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ aviso_movimentacao: novo }),
    })
    if (!r.ok) {
      setAviso(anterior)
      const d = await r.json().catch(() => ({}))
      toastError('Não foi possível salvar', d.error ?? 'Tente novamente.')
      return
    }
    success('Avisos ao cliente atualizados',
      novo === 'desligado' ? 'Nenhum aviso será enviado.'
      : novo === 'fila' ? 'Movimentos importantes entram na fila de aprovação.'
      : 'Movimentos importantes serão enviados automaticamente.')
  }

  async function simular(processoId: string) {
    if (aviso === 'automatico' && !confirm('Este cliente está em modo AUTOMÁTICO: simular vai ENVIAR uma mensagem real de teste ao WhatsApp dele. Deseja continuar?')) return
    setOcupado(processoId)
    try {
      const r = await fetch(`/api/processos/${processoId}/simular-movimento`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      const d = await r.json()
      if (!r.ok) { toastError('Falha ao simular', d.error ?? 'Tente novamente.'); return }
      if (d.enviado) success('Aviso de teste enviado ✅', 'A mensagem foi para o WhatsApp do cliente.')
      else if (d.notif_status === 'pendente') success('Movimento de teste criado', 'Entrou na fila de aprovação (Movimentações).')
      else toastError('Movimento criado, sem envio', d.motivo ?? 'Verifique a configuração de avisos.')
      await recarregarTimeline(processoId)
    } finally {
      setOcupado(null)
    }
  }

  const carregar = useCallback(async () => {
    setLoading(true)
    try {
      const r = await fetch(`/api/clientes/${clienteId}/processos`)
      const d = await r.json()
      if (r.ok) setProcessos(d.processos ?? [])
    } finally {
      setLoading(false)
    }
  }, [clienteId])

  useEffect(() => { void carregar() }, [carregar])

  async function adicionar(e: React.FormEvent) {
    e.preventDefault()
    if (salvando) return
    setSalvando(true)
    try {
      const r = await fetch(`/api/clientes/${clienteId}/processos`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ numero, apelido: apelido || null }),
      })
      const d = await r.json()
      if (!r.ok) {
        toastError('Não foi possível cadastrar', d.error ?? 'Tente novamente.')
        return
      }
      success(
        'Processo vinculado',
        d.sincronizado
          ? `${d.novosMovimentos} movimentação(ões) importada(s).`
          : 'Cadastrado. A sincronização automática ocorrerá em breve.',
      )
      setNumero(''); setApelido(''); setMostrarForm(false)
      await carregar()
    } finally {
      setSalvando(false)
    }
  }

  async function fetchTimeline(id: string) {
    setCarregandoTl(id)
    try {
      const r = await fetch(`/api/processos/${id}`)
      const d = await r.json()
      if (r.ok) setTimeline((t) => ({ ...t, [id]: d.movimentos ?? [] }))
    } finally {
      setCarregandoTl(null)
    }
  }

  async function abrirTimeline(id: string) {
    if (expandido === id) { setExpandido(null); return }
    setExpandido(id)
    if (!timeline[id]) await fetchTimeline(id)
  }

  // Reabre e RECARREGA a timeline (após simular/ressincronizar), sem depender do
  // valor stale de `expandido` — abrirTimeline faria toggle e colapsaria.
  async function recarregarTimeline(id: string) {
    setTimeline((t) => { const n = { ...t }; delete n[id]; return n })
    setExpandido(id)
    await fetchTimeline(id)
  }

  async function ressincronizar(id: string) {
    setOcupado(id)
    try {
      const r = await fetch(`/api/processos/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ressincronizar: true }),
      })
      const d = await r.json()
      if (!r.ok) { toastError('Falha ao sincronizar', d.error ?? 'Tente novamente.'); return }
      if (d.sincronizado === false) {
        toastError('DataJud indisponível', 'A consulta pública oscilou. Tente novamente em alguns instantes.')
        return
      }
      success('Sincronizado', `${d.novosMovimentos ?? 0} nova(s) movimentação(ões).`)
      if (expandido === id) await recarregarTimeline(id)
      else setTimeline((t) => { const n = { ...t }; delete n[id]; return n })
      await carregar()
    } finally {
      setOcupado(null)
    }
  }

  async function alternarSituacao(p: Processo) {
    setOcupado(p.id)
    const nova = p.situacao === 'ativo' ? 'encerrado' : 'ativo'
    try {
      const r = await fetch(`/api/processos/${p.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ situacao: nova }),
      })
      if (!r.ok) { const d = await r.json(); toastError('Falha', d.error ?? 'Tente novamente.'); return }
      await carregar()
    } finally {
      setOcupado(null)
    }
  }

  async function excluir(id: string) {
    if (!confirm('Desvincular este processo e apagar suas movimentações armazenadas?')) return
    setOcupado(id)
    try {
      const r = await fetch(`/api/processos/${id}`, { method: 'DELETE' })
      if (!r.ok) { const d = await r.json(); toastError('Falha ao excluir', d.error ?? 'Tente novamente.'); return }
      success('Processo desvinculado', '')
      await carregar()
    } finally {
      setOcupado(null)
    }
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="flex items-center gap-2 text-base">
          <Scale className="h-4 w-4 text-primary" />
          Processos {processos.length > 0 && <span className="text-muted-foreground font-normal">({processos.length})</span>}
        </CardTitle>
        <Button variant="secondary" size="sm" onClick={() => setMostrarForm((v) => !v)}>
          <Plus className="h-4 w-4" /> Vincular processo
        </Button>
      </CardHeader>
      <CardContent className="space-y-3">
        {podeGerenciar && (
          <div className="rounded-lg border border-border bg-muted/20 px-3 py-2">
            <div className="flex flex-wrap items-center gap-2">
              <BellRing className="h-4 w-4 text-primary shrink-0" />
              <span className="text-sm text-foreground">Avisos de movimentação ao cliente</span>
              <select
                value={aviso}
                onChange={(e) => salvarAviso(e.target.value as ModoAviso)}
                className="ml-auto rounded-md border border-border bg-background px-2 py-1.5 text-sm text-foreground"
              >
                <option value="desligado">Desligado</option>
                <option value="fila">Fila de aprovação</option>
                <option value="automatico">Automático</option>
              </select>
            </div>
            <p className="mt-1 text-[11px] text-muted-foreground">
              Ligado, o cliente é monitorado proativamente e recebe o aviso no WhatsApp do cadastro (vagas limitadas). Desligado, ele ainda pode consultar o andamento pelo WhatsApp quando quiser.
            </p>
          </div>
        )}

        {mostrarForm && (
          <form onSubmit={adicionar} className="rounded-lg border border-border bg-muted/30 p-3 space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="text-xs font-medium text-muted-foreground">Número do processo (CNJ)</label>
                <Input
                  value={numero}
                  onChange={(e) => setNumero(e.target.value)}
                  placeholder="0000000-00.0000.0.00.0000"
                  required
                />
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground">Apelido (opcional)</label>
                <Input value={apelido} onChange={(e) => setApelido(e.target.value)} placeholder="Ex.: Ação trabalhista" />
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Button type="submit" size="sm" disabled={salvando}>
                {salvando ? <><Spinner className="h-4 w-4" /> Consultando DataJud…</> : 'Vincular e sincronizar'}
              </Button>
              <Button type="button" variant="ghost" size="sm" onClick={() => setMostrarForm(false)}>Cancelar</Button>
            </div>
          </form>
        )}

        {loading ? (
          <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground"><Spinner className="h-4 w-4" /> Carregando…</div>
        ) : processos.length === 0 ? (
          <p className="py-3 text-sm text-muted-foreground italic">
            Nenhum processo vinculado. Vincule pelo número CNJ para acompanhar as movimentações automaticamente.
          </p>
        ) : (
          <ul className="space-y-2">
            {processos.map((p) => {
              const aberto = expandido === p.id
              const movs = timeline[p.id]
              return (
                <li key={p.id} className="rounded-lg border border-border overflow-hidden">
                  <div className="flex items-start gap-2 p-3">
                    <button
                      onClick={() => abrirTimeline(p.id)}
                      className="mt-0.5 text-muted-foreground hover:text-foreground shrink-0"
                      aria-label="Ver movimentações"
                    >
                      {aberto ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                    </button>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        <span className="font-medium text-foreground truncate">
                          {p.apelido || formatarCNJ(p.numero_cnj)}
                        </span>
                        <Badge variant={p.situacao === 'ativo' ? 'success' : 'secondary'}>
                          {p.situacao === 'ativo' ? 'Ativo' : 'Encerrado'}
                        </Badge>
                        <Badge variant="secondary" className="uppercase">{p.tribunal_alias}</Badge>
                      </div>
                      {p.apelido && <p className="text-xs text-muted-foreground mt-0.5">{formatarCNJ(p.numero_cnj)}</p>}
                      <p className="text-xs text-muted-foreground mt-0.5 flex flex-wrap items-center gap-x-2">
                        {p.classe && <span className="inline-flex items-center gap-1"><Landmark className="h-3 w-3" />{p.classe}</span>}
                        {p.orgao_julgador && <span className="truncate">{p.orgao_julgador}</span>}
                      </p>
                      <p className="text-[11px] text-muted-foreground mt-0.5">
                        {p.ultima_sincronizacao
                          ? `Sincronizado ${formatarDataRelativa(p.ultima_sincronizacao)}`
                          : 'Ainda não sincronizado'}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      {podeGerenciar && (
                        <Button variant="ghost" size="sm" title="Simular movimentação (teste de aviso)" disabled={ocupado === p.id} onClick={() => simular(p.id)}>
                          <FlaskConical className="h-4 w-4 text-primary" />
                        </Button>
                      )}
                      <Button variant="ghost" size="sm" title="Sincronizar agora" disabled={ocupado === p.id} onClick={() => ressincronizar(p.id)}>
                        <RefreshCw className={cn('h-4 w-4', ocupado === p.id && 'animate-spin')} />
                      </Button>
                      <Button variant="ghost" size="sm" title={p.situacao === 'ativo' ? 'Marcar como encerrado' : 'Reabrir'} disabled={ocupado === p.id} onClick={() => alternarSituacao(p)}>
                        {p.situacao === 'ativo' ? <Archive className="h-4 w-4" /> : <RotateCcw className="h-4 w-4" />}
                      </Button>
                      <Button variant="ghost" size="sm" title="Desvincular" disabled={ocupado === p.id} onClick={() => excluir(p.id)}>
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </div>
                  </div>

                  {aberto && (
                    <div className="border-t border-border bg-muted/20 p-3">
                      {carregandoTl === p.id ? (
                        <div className="flex items-center gap-2 text-sm text-muted-foreground"><Spinner className="h-4 w-4" /> Carregando movimentações…</div>
                      ) : !movs || movs.length === 0 ? (
                        <p className="text-sm text-muted-foreground italic">Nenhuma movimentação armazenada.</p>
                      ) : (
                        <ol className="space-y-3">
                          {movs.map((m) => {
                            const cat = m.categoria ? CATEGORIA_BADGE[m.categoria] : null
                            return (
                              <li key={m.id} className="relative pl-4 border-l-2 border-border">
                                <span className="absolute -left-[5px] top-1.5 h-2 w-2 rounded-full bg-primary" />
                                <div className="flex flex-wrap items-center gap-2">
                                  <span className="text-xs text-muted-foreground">{m.data_hora ? formatarData(m.data_hora) : '—'}</span>
                                  {cat && <Badge variant={cat.variant}>{cat.label}</Badge>}
                                </div>
                                {m.resumo_ia && <p className="text-sm text-foreground mt-0.5">{m.resumo_ia}</p>}
                                <p className={cn('text-xs mt-0.5', m.resumo_ia ? 'text-muted-foreground' : 'text-foreground')}>{m.nome}</p>
                              </li>
                            )
                          })}
                        </ol>
                      )}
                    </div>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}
