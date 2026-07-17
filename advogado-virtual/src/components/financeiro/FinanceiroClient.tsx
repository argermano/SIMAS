'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import {
  Wallet, CalendarClock, AlertTriangle, CheckCircle2, Copy, HandCoins,
  XCircle, Plus, Search, ChevronLeft, ChevronRight, FilterX, MessageSquare, FileClock, Receipt,
  TrendingUp, Sparkles, Trash2, FileSignature
} from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Spinner } from '@/components/ui/spinner'
import { EmptyState } from '@/components/ui/empty-state'
import { ConfirmDialog } from '@/components/ui/dialog'
import { useToast } from '@/components/ui/toast'
import { cn, formatarData } from '@/lib/utils'
import { formatarValor } from '@/lib/financeiro/parcelas'
import { gerarPixCopiaECola } from '@/lib/financeiro/pix'
import { ModalBaixa } from './ModalBaixa'
import { ModalComunicar } from './ModalComunicar'
import { ModalNovaCobranca, type PrefillContrato } from './ModalNovaCobranca'
import { ConferirComprovanteModal } from './ConferirComprovanteModal'
import { InboxComprovantes } from './InboxComprovantes'
import { PagamentoModal } from './PagamentoModal'
import { type Parcela, type PixConfig, LABELS_MEIO, hojeISO, somarDiasISO, ehVencida, aguardandoBaixa, ehPrevisao } from './tipos'

// ─────────────────────────────────────────────────────────────
// Tipos locais
// ─────────────────────────────────────────────────────────────

interface Indicador { count: number; somaCentavos: number }
interface Resumo { aVencer7d: Indicador; vencidas: Indicador; recebidoMes: Indicador; previsto: Indicador }

interface Filtros {
  status: string       // '' | aberta | paga | cancelada
  de: string           // vencimento >= (YYYY-MM-DD)
  ate: string          // vencimento <=
  pagoDe: string       // pago_em >= (YYYY-MM-DD) — preset "Recebido no mês"
  pagoAte: string      // pago_em <=
  q: string            // busca por cliente
}

type Preset = 'a_vencer' | 'vencidas' | 'recebido_mes' | 'previsto' | null

const FILTROS_VAZIOS: Filtros = { status: '', de: '', ate: '', pagoDe: '', pagoAte: '', q: '' }

/** Último dia do mês da data ISO informada (YYYY-MM-DD). */
function fimDoMes(iso: string): string {
  const [a, m] = iso.split('-').map(Number)
  const ultimo = new Date(a, m, 0).getDate()
  return `${iso.slice(0, 7)}-${String(ultimo).padStart(2, '0')}`
}

function parseIndicador(o: unknown): Indicador {
  const x = (o ?? {}) as Record<string, unknown>
  return {
    count:        Number(x.quantidade ?? x.count ?? x.total ?? 0),
    somaCentavos: Number(x.somaCentavos ?? x.soma_centavos ?? x.soma ?? 0),
  }
}

// ─────────────────────────────────────────────────────────────
// Componente principal
// ─────────────────────────────────────────────────────────────

export function FinanceiroClient() {
  const { success, error: toastError } = useToast()
  const searchParams = useSearchParams()
  const hoje = useMemo(() => hojeISO(), [])

  const [resumo, setResumo]     = useState<Resumo | null>(null)
  const [parcelas, setParcelas] = useState<Parcela[]>([])
  const [total, setTotal]       = useState(0)
  const [pagina, setPagina]     = useState(1)
  const [loading, setLoading]   = useState(true)
  const [filtros, setFiltros]   = useState<Filtros>({ ...FILTROS_VAZIOS, status: 'aberta' })
  const [preset, setPreset]     = useState<Preset>(null)
  const [buscaLocal, setBuscaLocal] = useState('')
  // Filtro rápido "aguardando baixa": mostra só as parcelas abertas com
  // comprovante recebido aguardando conferência. É SERVER-SIDE (paginado) e o
  // contador vem do TOTAL do tenant — nunca subconta a página carregada.
  const [soAguardando, setSoAguardando] = useState(false)
  const [aguardandoTotal, setAguardandoTotal] = useState(0)

  // Config Pix do escritório (para o Copiar Pix)
  const [pix, setPix] = useState<PixConfig | null>(null)

  // Modais
  const [parcelaBaixa, setParcelaBaixa]       = useState<Parcela | null>(null)
  const [parcelaComunicar, setParcelaComunicar] = useState<Parcela | null>(null)
  const [parcelaCancelar, setParcelaCancelar] = useState<Parcela | null>(null)
  const [cancelando, setCancelando]           = useState(false)
  const [novaAberta, setNovaAberta]           = useState(false)
  const [prefill, setPrefill]                 = useState<PrefillContrato | null>(null)
  const [parcelaConferir, setParcelaConferir] = useState<Parcela | null>(null)
  const [parcelaPagamento, setParcelaPagamento] = useState<Parcela | null>(null)

  // ── Carregamento ────────────────────────────────────────────

  const carregarResumo = useCallback(async () => {
    try {
      const r = await fetch('/api/financeiro/resumo')
      if (!r.ok) return
      const d = await r.json()
      setResumo({
        aVencer7d:   parseIndicador(d.aVencer7d ?? d.a_vencer_7d ?? d.aVencer),
        vencidas:    parseIndicador(d.vencidas),
        recebidoMes: parseIndicador(d.recebidoMes ?? d.recebido_mes ?? d.recebido),
        previsto:    parseIndicador(d.previsto),
      })
    } catch { /* resumo é decorativo — não bloqueia a lista */ }
  }, [])

  // Total do tenant de parcelas "aguardando baixa" (para o chip) — independente
  // da página. Barato: pede só o count (limit=1).
  const carregarAguardandoTotal = useCallback(async () => {
    try {
      const r = await fetch('/api/financeiro/parcelas?aguardando=1&limit=1')
      if (!r.ok) return
      const d = await r.json().catch(() => ({}))
      setAguardandoTotal(Number(d.total ?? 0))
    } catch { /* chip é auxiliar — não bloqueia */ }
  }, [])

  const carregarParcelas = useCallback(async (f: Filtros, pag: number, soAg: boolean) => {
    setLoading(true)
    try {
      const qs = new URLSearchParams()
      // "Aguardando baixa" sobrepõe o filtro de status (é sempre aberta).
      if (soAg)      qs.set('aguardando', '1')
      else if (f.status) qs.set('status', f.status)
      if (f.de)      qs.set('de', f.de)
      if (f.ate)     qs.set('ate', f.ate)
      if (f.pagoDe)  qs.set('pagoDe', f.pagoDe)
      if (f.pagoAte) qs.set('pagoAte', f.pagoAte)
      if (f.q)       qs.set('q', f.q)
      qs.set('page', String(pag))
      const r = await fetch(`/api/financeiro/parcelas?${qs.toString()}`)
      const d = await r.json().catch(() => ({}))
      if (!r.ok) {
        toastError('Não foi possível carregar as parcelas', d.error ?? 'Tente novamente.')
        return
      }
      const lista: Parcela[] = d.parcelas ?? d.data ?? []
      setParcelas(lista)
      setTotal(Number(d.total ?? d.count ?? lista.length))
    } catch {
      toastError('Falha de rede', 'Não foi possível falar com o servidor.')
    } finally {
      setLoading(false)
    }
  }, [toastError])

  useEffect(() => { carregarResumo() }, [carregarResumo])
  useEffect(() => { carregarAguardandoTotal() }, [carregarAguardandoTotal])
  useEffect(() => { carregarParcelas(filtros, pagina, soAguardando) }, [carregarParcelas, filtros, pagina, soAguardando])

  useEffect(() => {
    fetch('/api/escritorio/config-financeiro')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!d) return
        const f = (d.financeiro ?? d) as Partial<PixConfig>
        if (f.pix_chave) {
          setPix({ pix_chave: f.pix_chave, pix_nome: f.pix_nome ?? '', pix_cidade: f.pix_cidade ?? '' })
        }
      })
      .catch(() => {})
  }, [])

  // Deep-link ?contrato=<id>: pré-carrega cliente/valor/forma do contrato e abre o modal.
  const contratoTratado = useRef(false)
  useEffect(() => {
    const contratoId = searchParams.get('contrato')
    if (!contratoId || contratoTratado.current) return
    contratoTratado.current = true
    ;(async () => {
      try {
        const r = await fetch(`/api/contratos/${contratoId}`)
        const d = await r.json().catch(() => ({}))
        if (!r.ok || !d.contrato) {
          toastError('Contrato não encontrado', 'Abra a cobrança manualmente.')
          return
        }
        const c = d.contrato as {
          id: string; cliente_id: string | null; valor_fixo: number | null
          forma_pagamento: string | null; clientes?: { nome?: string | null } | null
        }
        setPrefill({
          contratoId:     c.id,
          clienteId:      c.cliente_id ?? null,
          clienteNome:    c.clientes?.nome ?? null,
          valorCentavos:  c.valor_fixo != null ? Math.round(Number(c.valor_fixo) * 100) : null,
          formaPagamento: c.forma_pagamento ?? null,
        })
        setNovaAberta(true)
        // Limpa o parâmetro para não reabrir o modal em refresh (sem rerender).
        window.history.replaceState(null, '', '/financeiro')
      } catch {
        toastError('Falha ao carregar o contrato', 'Abra a cobrança manualmente.')
      }
    })()
  }, [searchParams, toastError])

  // ── Ações ───────────────────────────────────────────────────

  function aplicarPreset(p: Preset) {
    setPagina(1)
    if (preset === p) { setPreset(null); setFiltros({ ...FILTROS_VAZIOS, status: 'aberta' }); return }
    setPreset(p)
    setBuscaLocal('')
    if (p === 'a_vencer')     setFiltros({ ...FILTROS_VAZIOS, status: 'aberta', de: hoje, ate: somarDiasISO(hoje, 7) })
    if (p === 'vencidas')     setFiltros({ ...FILTROS_VAZIOS, status: 'vencida' })
    // "Recebido no mês" filtra por DATA DO PAGAMENTO (pago_em) — igual ao
    // indicador do card, que soma por pago_em (não por vencimento).
    if (p === 'recebido_mes') setFiltros({ ...FILTROS_VAZIOS, status: 'paga', pagoDe: `${hoje.slice(0, 7)}-01`, pagoAte: fimDoMes(hoje) })
    if (p === 'previsto')     setFiltros({ ...FILTROS_VAZIOS, status: 'prevista' })
  }

  function mudarFiltro(patch: Partial<Filtros>) {
    setPreset(null)
    setPagina(1)
    setFiltros((f) => ({ ...f, ...patch }))
  }

  function limparFiltros() {
    setPreset(null)
    setPagina(1)
    setBuscaLocal('')
    setSoAguardando(false)
    setFiltros({ ...FILTROS_VAZIOS })
  }

  // Alterna o filtro "aguardando baixa" (server-side): sempre volta à página 1
  // e limpa qualquer preset ativo para não misturar os dois recortes.
  function alternarAguardando() {
    setPreset(null)
    setPagina(1)
    setSoAguardando((v) => !v)
  }

  async function copiarPix(p: Parcela) {
    if (!pix?.pix_chave) return
    try {
      const codigo = gerarPixCopiaECola({
        chave:         pix.pix_chave,
        nome:          pix.pix_nome || 'Recebedor',
        cidade:        pix.pix_cidade || 'BRASIL',
        valorCentavos: p.valor_centavos,
        txid:          p.id.replace(/-/g, '').slice(0, 25),
      })
      await navigator.clipboard.writeText(codigo)
      success('Pix copiado', `Copia-e-cola de ${formatarValor(p.valor_centavos)} pronto para enviar ao cliente.`)
    } catch {
      toastError('Não foi possível copiar', 'Verifique a configuração do Pix em Configurações.')
    }
  }

  async function cancelarParcela() {
    if (!parcelaCancelar) return
    setCancelando(true)
    try {
      const r = await fetch(`/api/financeiro/parcelas/${parcelaCancelar.id}/cancelar`, { method: 'POST' })
      const d = await r.json().catch(() => ({}))
      if (!r.ok) { toastError('Não foi possível cancelar', d.error ?? 'Tente novamente.'); return }
      success('Cobrança cancelada', parcelaCancelar.descricao)
      setParcelaCancelar(null)
      aposMudanca()
    } finally {
      setCancelando(false)
    }
  }

  // Previsão → "Gerar parcelas": abre o modal de nova cobrança já com os dados do
  // contrato (mesmo fluxo do deep-link da tarefa). A série real criada substitui
  // a previsão (o POST de parcelas remove a previsão no servidor).
  async function gerarParcelasPrevisao(p: Parcela) {
    if (!p.contrato_id) { setPrefill(null); setNovaAberta(true); return }
    try {
      const r = await fetch(`/api/contratos/${p.contrato_id}`)
      const d = await r.json().catch(() => ({}))
      if (!r.ok || !d.contrato) {
        toastError('Contrato não encontrado', 'Abra a cobrança manualmente.')
        setPrefill(null); setNovaAberta(true); return
      }
      const c = d.contrato as {
        id: string; cliente_id: string | null; valor_fixo: number | null
        forma_pagamento: string | null; clientes?: { nome?: string | null } | null
      }
      setPrefill({
        contratoId:     c.id,
        clienteId:      c.cliente_id ?? null,
        clienteNome:    c.clientes?.nome ?? null,
        valorCentavos:  c.valor_fixo != null ? Math.round(Number(c.valor_fixo) * 100) : null,
        formaPagamento: c.forma_pagamento ?? null,
      })
      setNovaAberta(true)
    } catch {
      toastError('Falha ao carregar o contrato', 'Abra a cobrança manualmente.')
    }
  }

  // Remove uma previsão (estimativa) — sem cerimônia; a rota gateia por 'prevista'.
  async function removerPrevisao(p: Parcela) {
    try {
      const r = await fetch(`/api/financeiro/parcelas/${p.id}`, { method: 'DELETE' })
      const d = await r.json().catch(() => ({}))
      if (!r.ok) { toastError('Não foi possível remover a previsão', d.error ?? 'Tente novamente.'); return }
      success('Previsão removida', p.descricao)
      aposMudanca()
    } catch {
      toastError('Falha de rede', 'Não foi possível falar com o servidor.')
    }
  }

  function aposMudanca() {
    carregarResumo()
    carregarAguardandoTotal()
    carregarParcelas(filtros, pagina, soAguardando)
  }

  const totalPaginas = Math.max(1, Math.ceil(total / 20))
  const pixConfigurado = Boolean(pix?.pix_chave)

  // A lista já vem filtrada do servidor (aguardando=1) quando soAguardando.
  const parcelasVisiveis = parcelas
  // Desliga o filtro só quando NÃO resta NENHUMA aguardando no tenant inteiro
  // (total do servidor) — não com base na página, para não dar falso "tudo
  // conferido" enquanto sobram pendentes em páginas seguintes.
  useEffect(() => { if (soAguardando && aguardandoTotal === 0) setSoAguardando(false) }, [soAguardando, aguardandoTotal])

  // ── Render ──────────────────────────────────────────────────

  return (
    <div className="space-y-5">
      {/* Inbox de comprovantes recebidos sem cobrança (migration 053): aparece
          só quando há pendentes. Atribuir/descartar recarrega as parcelas. */}
      <InboxComprovantes onChange={aposMudanca} />

      {/* Indicadores */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <IndicadorCard
          ativo={preset === 'a_vencer'}
          onClick={() => aplicarPreset('a_vencer')}
          icone={<CalendarClock className="h-5 w-5" />}
          tom="info"
          rotulo="A vencer (7 dias)"
          indicador={resumo?.aVencer7d}
        />
        <IndicadorCard
          ativo={preset === 'vencidas'}
          onClick={() => aplicarPreset('vencidas')}
          icone={<AlertTriangle className="h-5 w-5" />}
          tom="destructive"
          rotulo="Vencidas"
          indicador={resumo?.vencidas}
        />
        <IndicadorCard
          ativo={preset === 'recebido_mes'}
          onClick={() => aplicarPreset('recebido_mes')}
          icone={<CheckCircle2 className="h-5 w-5" />}
          tom="success"
          rotulo="Recebido no mês"
          indicador={resumo?.recebidoMes}
        />
        {/* Previsto: soma das previsões de recebimento de contratos (estimativa,
            separada de "em aberto"). Só aparece com clique quando há previsões. */}
        <IndicadorCard
          ativo={preset === 'previsto'}
          onClick={() => aplicarPreset('previsto')}
          icone={<TrendingUp className="h-5 w-5" />}
          tom="accent"
          rotulo="Previsto"
          indicador={resumo?.previsto}
        />
      </div>

      {/* Filtros + ação */}
      <div className="flex flex-wrap items-end gap-2">
        <div className="w-40">
          <Select
            label="Status"
            value={filtros.status}
            onChange={(e) => mudarFiltro({ status: e.target.value })}
            options={[
              { value: '',          label: 'Todas' },
              { value: 'aberta',    label: 'Abertas' },
              { value: 'vencida',   label: 'Vencidas' },
              { value: 'paga',      label: 'Pagas' },
              { value: 'prevista',  label: 'Previstas' },
              { value: 'cancelada', label: 'Canceladas' },
            ]}
          />
        </div>
        <div className="w-40">
          <Input label="Vencimento de" type="date" value={filtros.de} onChange={(e) => mudarFiltro({ de: e.target.value })} />
        </div>
        <div className="w-40">
          <Input label="até" type="date" value={filtros.ate} onChange={(e) => mudarFiltro({ ate: e.target.value })} />
        </div>
        <form
          className="w-56"
          onSubmit={(e) => { e.preventDefault(); mudarFiltro({ q: buscaLocal.trim() }) }}
        >
          <Input
            label="Cliente"
            placeholder="Buscar por nome…"
            leftIcon={<Search className="h-4 w-4" />}
            value={buscaLocal}
            onChange={(e) => setBuscaLocal(e.target.value)}
            onBlur={() => { if (buscaLocal.trim() !== filtros.q) mudarFiltro({ q: buscaLocal.trim() }) }}
          />
        </form>
        {aguardandoTotal > 0 && (
          <button
            type="button"
            onClick={alternarAguardando}
            aria-pressed={soAguardando}
            title={soAguardando ? 'Mostrar todas as parcelas' : 'Mostrar só as que têm comprovante para conferir'}
            className={cn(
              'mb-1 inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors',
              soAguardando
                ? 'border-warning bg-warning/15 text-warning'
                : 'border-warning/40 text-warning hover:bg-warning/10',
            )}
          >
            <FileClock className="h-3.5 w-3.5" /> Aguardando baixa ({aguardandoTotal})
          </button>
        )}
        {(filtros.q || filtros.de || filtros.ate || filtros.status !== 'aberta' || preset) && (
          <Button variant="ghost" size="sm" onClick={limparFiltros} className="mb-1">
            <FilterX className="h-4 w-4" /> Limpar
          </Button>
        )}
        <div className="ml-auto mb-1">
          <Button size="sm" onClick={() => { setPrefill(null); setNovaAberta(true) }}>
            <Plus className="h-4 w-4" /> Nova cobrança
          </Button>
        </div>
      </div>

      {/* Lista */}
      <Card>
        <CardContent className="p-0">
          {loading ? (
            <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
              <Spinner className="h-5 w-5" /> Carregando parcelas…
            </div>
          ) : parcelasVisiveis.length === 0 ? (
            <EmptyState
              icon={<Wallet className="h-10 w-10" />}
              title="Nenhuma parcela encontrada"
              description={
                soAguardando
                  ? 'Nenhuma parcela aguardando baixa no momento.'
                  : filtros.q || filtros.de || filtros.ate || preset
                  ? 'Ajuste os filtros ou limpe a busca.'
                  : 'Crie a primeira cobrança para começar a acompanhar os honorários.'
              }
              action={{ label: 'Nova cobrança', onClick: () => { setPrefill(null); setNovaAberta(true) } }}
              className="py-14"
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[760px] text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                    <th className="px-4 py-3 font-medium">Cliente</th>
                    <th className="px-4 py-3 font-medium">Descrição</th>
                    <th className="px-4 py-3 font-medium text-right">Valor</th>
                    <th className="px-4 py-3 font-medium">Vencimento</th>
                    <th className="px-4 py-3 font-medium">Status</th>
                    <th className="px-4 py-3 font-medium">Meio</th>
                    <th className="px-4 py-3 font-medium text-right">Ações</th>
                  </tr>
                </thead>
                <tbody>
                  {parcelasVisiveis.map((p) => {
                    const vencida = ehVencida(p, hoje)
                    const aguardando = aguardandoBaixa(p)
                    return (
                      <tr key={p.id} className="border-b border-border/60 last:border-0 hover:bg-muted/30 transition-colors">
                        <td className="px-4 py-3">
                          <Link href={`/clientes/${p.cliente_id}`} className="font-medium text-foreground hover:text-primary hover:underline">
                            {p.cliente_nome ?? 'Cliente'}
                          </Link>
                        </td>
                        <td className="max-w-[240px] truncate px-4 py-3 text-muted-foreground" title={p.descricao}>
                          {p.descricao}
                        </td>
                        <td className="px-4 py-3 text-right font-semibold tabular-nums text-foreground">
                          {formatarValor(p.valor_centavos)}
                        </td>
                        <td className={cn('px-4 py-3 tabular-nums', vencida ? 'font-semibold text-destructive' : 'text-foreground')}>
                          {formatarData(p.vencimento)}
                          {vencida && <span className="ml-1.5 text-[11px] font-medium uppercase">vencida</span>}
                        </td>
                        <td className="px-4 py-3">
                          {aguardando ? (
                            <Badge variant="warning" className="gap-1 ring-1 ring-warning/40">
                              <FileClock className="h-3 w-3" /> Aguardando baixa
                            </Badge>
                          ) : p.status === 'prevista' ? (
                            <Badge variant="accent" className="gap-1">
                              <Sparkles className="h-3 w-3" /> Previsão
                            </Badge>
                          ) : p.status === 'paga' ? (
                            <Badge variant="success">Paga</Badge>
                          ) : p.status === 'cancelada' ? (
                            <Badge variant="default">Cancelada</Badge>
                          ) : vencida ? (
                            <Badge variant="danger">Vencida</Badge>
                          ) : (
                            <Badge variant="warning">Aberta</Badge>
                          )}
                        </td>
                        <td className="px-4 py-3 text-muted-foreground">
                          {p.meio ? LABELS_MEIO[p.meio] ?? p.meio : '—'}
                          {p.status === 'paga' && p.pago_em && (
                            <span className="block text-[11px]">{formatarData(p.pago_em)}</span>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          {ehPrevisao(p) ? (
                            <div className="flex items-center justify-end gap-1">
                              <button
                                type="button"
                                onClick={() => gerarParcelasPrevisao(p)}
                                title="Gerar as parcelas reais deste contrato (substitui a previsão)"
                                className="inline-flex items-center gap-1 rounded-md px-2 py-1.5 text-xs font-semibold text-primary hover:bg-primary/10 transition-colors"
                              >
                                <FileSignature className="h-3.5 w-3.5" /> Gerar parcelas
                              </button>
                              <button
                                type="button"
                                onClick={() => removerPrevisao(p)}
                                title="Remover a previsão (é só uma estimativa)"
                                className="inline-flex items-center gap-1 rounded-md px-2 py-1.5 text-xs font-medium text-destructive hover:bg-destructive/10 transition-colors"
                              >
                                <Trash2 className="h-3.5 w-3.5" /> Remover previsão
                              </button>
                            </div>
                          ) : p.status === 'aberta' ? (
                            <div className="flex items-center justify-end gap-1">
                              {aguardando && (
                                <button
                                  type="button"
                                  onClick={() => setParcelaConferir(p)}
                                  title="Conferir o comprovante recebido e dar baixa"
                                  className="inline-flex items-center gap-1 rounded-md bg-warning/15 px-2 py-1.5 text-xs font-semibold text-warning hover:bg-warning/25 transition-colors"
                                >
                                  <FileClock className="h-3.5 w-3.5" /> Conferir baixa
                                </button>
                              )}
                              <button
                                type="button"
                                onClick={() => copiarPix(p)}
                                disabled={!pixConfigurado}
                                title={pixConfigurado ? 'Copiar Pix copia-e-cola' : 'Configure a chave Pix em Configurações'}
                                className={cn(
                                  'inline-flex items-center gap-1 rounded-md px-2 py-1.5 text-xs font-medium transition-colors',
                                  pixConfigurado
                                    ? 'text-primary hover:bg-primary/10'
                                    : 'cursor-not-allowed text-muted-foreground/50'
                                )}
                              >
                                <Copy className="h-3.5 w-3.5" /> Pix
                              </button>
                              <button
                                type="button"
                                onClick={() => setParcelaComunicar(p)}
                                title="Comunicar cobrança por WhatsApp (revisa a mensagem antes de enviar)"
                                className="inline-flex items-center gap-1 rounded-md px-2 py-1.5 text-xs font-medium text-foreground hover:bg-muted transition-colors"
                              >
                                <MessageSquare className="h-3.5 w-3.5" /> WhatsApp
                              </button>
                              <button
                                type="button"
                                onClick={() => setParcelaBaixa(p)}
                                title="Registrar pagamento (dar baixa)"
                                className="inline-flex items-center gap-1 rounded-md px-2 py-1.5 text-xs font-medium text-success hover:bg-success/10 transition-colors"
                              >
                                <HandCoins className="h-3.5 w-3.5" /> Dar baixa
                              </button>
                              <button
                                type="button"
                                onClick={() => setParcelaCancelar(p)}
                                title="Cancelar cobrança"
                                className="inline-flex items-center gap-1 rounded-md px-2 py-1.5 text-xs font-medium text-destructive hover:bg-destructive/10 transition-colors"
                              >
                                <XCircle className="h-3.5 w-3.5" /> Cancelar
                              </button>
                            </div>
                          ) : p.status === 'paga' ? (
                            <div className="flex items-center justify-end">
                              <button
                                type="button"
                                onClick={() => setParcelaPagamento(p)}
                                title="Ver os dados do pagamento e o comprovante"
                                className="inline-flex items-center gap-1 rounded-md px-2 py-1.5 text-xs font-medium text-foreground hover:bg-muted transition-colors"
                              >
                                <Receipt className="h-3.5 w-3.5" /> Ver pagamento
                              </button>
                            </div>
                          ) : (
                            <span className="block text-right text-xs text-muted-foreground">—</span>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Paginação */}
      {!loading && total > 20 && (
        <div className="flex items-center justify-between text-sm text-muted-foreground">
          <span>{total} parcela{total === 1 ? '' : 's'}</span>
          <div className="flex items-center gap-2">
            <Button variant="secondary" size="sm" disabled={pagina <= 1} onClick={() => setPagina((p) => p - 1)}>
              <ChevronLeft className="h-4 w-4" /> Anterior
            </Button>
            <span className="tabular-nums">{pagina} / {totalPaginas}</span>
            <Button variant="secondary" size="sm" disabled={pagina >= totalPaginas} onClick={() => setPagina((p) => p + 1)}>
              Próxima <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}

      {/* Modais */}
      <ModalComunicar
        parcela={parcelaComunicar}
        onFechar={() => setParcelaComunicar(null)}
        onEnviado={() => { /* nada a recarregar — envio não muda a parcela */ }}
      />

      <ModalBaixa
        parcela={parcelaBaixa}
        onClose={() => setParcelaBaixa(null)}
        onDone={() => { setParcelaBaixa(null); aposMudanca() }}
      />
      <ConferirComprovanteModal
        parcela={parcelaConferir}
        onClose={() => setParcelaConferir(null)}
        onDone={() => { setParcelaConferir(null); aposMudanca() }}
      />
      <PagamentoModal
        parcela={parcelaPagamento}
        onClose={() => setParcelaPagamento(null)}
      />
      <ModalNovaCobranca
        open={novaAberta}
        prefill={prefill}
        onClose={() => { setNovaAberta(false); setPrefill(null) }}
        onDone={() => { setNovaAberta(false); setPrefill(null); aposMudanca() }}
      />
      <ConfirmDialog
        open={Boolean(parcelaCancelar)}
        onClose={() => setParcelaCancelar(null)}
        onConfirm={cancelarParcela}
        loading={cancelando}
        variant="danger"
        title="Cancelar cobrança"
        confirmLabel="Cancelar cobrança"
        cancelLabel="Voltar"
        description={
          parcelaCancelar ? (
            <>
              A parcela <strong>{parcelaCancelar.descricao}</strong> de{' '}
              <strong>{formatarValor(parcelaCancelar.valor_centavos)}</strong> será marcada como
              cancelada e deixará de gerar avisos. Essa ação não pode ser desfeita.
            </>
          ) : ''
        }
      />
    </div>
  )
}

// ─────────────────────────────────────────────────────────────
// Indicador clicável
// ─────────────────────────────────────────────────────────────

const TONS = {
  info:        { icone: 'bg-info/10 text-info',               ativo: 'ring-info/50' },
  destructive: { icone: 'bg-destructive/10 text-destructive', ativo: 'ring-destructive/50' },
  success:     { icone: 'bg-success/10 text-success',         ativo: 'ring-success/50' },
  accent:      { icone: 'bg-primary-glow/10 text-primary-glow', ativo: 'ring-primary-glow/50' },
} as const

function IndicadorCard({
  rotulo, indicador, icone, tom, ativo, onClick,
}: {
  rotulo: string
  indicador?: Indicador
  icone: React.ReactNode
  tom: keyof typeof TONS
  ativo: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={ativo}
      title={ativo ? 'Clique para remover o filtro' : 'Clique para filtrar a lista'}
      className={cn(
        'flex items-center gap-3 rounded-xl border border-border bg-card p-4 text-left shadow-sm transition-all',
        'hover:border-primary/40 hover:shadow',
        ativo && `ring-2 ${TONS[tom].ativo} border-transparent`
      )}
    >
      <div className={cn('flex h-10 w-10 shrink-0 items-center justify-center rounded-lg', TONS[tom].icone)}>
        {icone}
      </div>
      <div className="min-w-0">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{rotulo}</p>
        {indicador ? (
          <p className="truncate text-lg font-bold tabular-nums text-foreground">
            {formatarValor(indicador.somaCentavos)}
            <span className="ml-2 text-xs font-medium text-muted-foreground">
              {indicador.count} parcela{indicador.count === 1 ? '' : 's'}
            </span>
          </p>
        ) : (
          <p className="text-lg font-bold text-muted-foreground/40">—</p>
        )}
      </div>
    </button>
  )
}
