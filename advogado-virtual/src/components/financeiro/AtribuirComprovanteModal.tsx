'use client'

import { useCallback, useEffect, useState } from 'react'
import { Search, User, X, Wallet, PlusCircle, ScanLine } from 'lucide-react'
import { Dialog } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Spinner } from '@/components/ui/spinner'
import { useToast } from '@/components/ui/toast'
import { cn, formatarData, formatarMoedaInput, moedaParaNumero } from '@/lib/utils'
import { formatarValor } from '@/lib/financeiro/parcelas'
import { LABELS_MEIO } from './tipos'
import type { ComprovanteRecebido } from './InboxComprovantes'

// Opção especial do passo 2: criar uma cobrança nova em vez de baixar uma
// parcela existente. Valor sentinela para o radio group.
const NOVA = '__nova__'

const MEIOS = Object.entries(LABELS_MEIO).map(([value, label]) => ({ value, label }))

interface ClienteLeve { id: string; nome: string }
// Parcela aberta vinda de /api/financeiro/parcelas-do-cliente.
interface ParcelaAberta { id: string; descricao: string; valor_centavos: number; vencimento: string }

/** "2026-07-11T…" | "2026-07-11" -> "2026-07-11" (para o <input type=date>). */
function soData(iso: string | undefined): string {
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(iso ?? '')
  return m ? m[1] : ''
}

function mensagemErro(data: unknown, fallback: string): string {
  if (data && typeof data === 'object' && 'error' in data) {
    const e = (data as { error?: unknown }).error
    if (typeof e === 'string' && e) return e
  }
  return fallback
}

/**
 * Atribui um comprovante do inbox (migration 053) a um contrato/cliente. Dois
 * passos: (1) escolher o cliente — já vem selecionado se o telefone casou;
 * (2) baixar uma parcela ABERTA existente OU criar uma cobrança nova e baixá-la
 * na hora com este comprovante. O clique de "Atribuir e dar baixa" É a
 * confirmação humana (a baixa nunca é automática).
 */
export function AtribuirComprovanteModal({
  comprovante,
  onClose,
  onDone,
}: {
  comprovante: ComprovanteRecebido | null
  onClose: () => void
  onDone: () => void
}) {
  const { success, error: toastError } = useToast()

  // Passo 1 — cliente
  const [cliente, setCliente]       = useState<ClienteLeve | null>(null)
  const [busca, setBusca]           = useState('')
  const [buscando, setBuscando]     = useState(false)
  const [resultados, setResultados] = useState<ClienteLeve[]>([])

  // Passo 2 — parcelas abertas + escolha
  const [parcelas, setParcelas]           = useState<ParcelaAberta[]>([])
  const [carregandoParc, setCarregandoParc] = useState(false)
  const [escolha, setEscolha]             = useState<string>('') // id da parcela | NOVA | ''

  // Campos da cobrança nova (default = extração da IA)
  const [descricao, setDescricao]   = useState('Honorários')
  const [valor, setValor]           = useState('')
  const [vencimento, setVencimento] = useState('')
  const [meio, setMeio]             = useState('pix')

  const [salvando, setSalvando] = useState(false)

  // Reset ao abrir/trocar de comprovante: semeia cliente (se casado) e os
  // defaults da cobrança nova a partir dos dados extraídos.
  useEffect(() => {
    if (!comprovante) return
    setCliente(comprovante.cliente_id ? { id: comprovante.cliente_id, nome: comprovante.cliente_nome ?? 'Cliente' } : null)
    setBusca('')
    setResultados([])
    setParcelas([])
    setEscolha('')
    setDescricao('Honorários')
    setValor(formatarMoedaInput(String(comprovante.dados?.valorCentavos ?? 0)))
    setVencimento(soData(comprovante.dados?.dataISO))
    setMeio('pix')
  }, [comprovante])

  // Busca leve de clientes (só quando ninguém está selecionado) — mesmo padrão
  // do ModalNovaCobranca (debounce simples, /api/clientes?q=).
  useEffect(() => {
    if (!comprovante || cliente || busca.trim().length < 2) { setResultados([]); return }
    const t = setTimeout(async () => {
      setBuscando(true)
      try {
        const r = await fetch(`/api/clientes?q=${encodeURIComponent(busca.trim())}`)
        const d = await r.json().catch(() => ({}))
        if (r.ok) {
          setResultados(((d.clientes ?? []) as Array<{ id: string; nome: string }>)
            .slice(0, 6)
            .map((c) => ({ id: c.id, nome: c.nome })))
        }
      } finally {
        setBuscando(false)
      }
    }, 300)
    return () => clearTimeout(t)
  }, [busca, comprovante, cliente])

  // Carrega as parcelas abertas do cliente escolhido (passo 2). Sem cliente,
  // limpa. Reaproveita a rota já existente /parcelas-do-cliente.
  const carregarParcelas = useCallback(async (clienteId: string) => {
    setCarregandoParc(true)
    try {
      const r = await fetch(`/api/financeiro/parcelas-do-cliente?clienteId=${encodeURIComponent(clienteId)}`)
      const d = await r.json().catch(() => ({}))
      const lista: ParcelaAberta[] = (d.parcelas ?? []) as ParcelaAberta[]
      setParcelas(lista)
      // Sem parcela aberta -> já mira em "criar nova cobrança".
      setEscolha(lista.length === 0 ? NOVA : '')
    } catch {
      setParcelas([]); setEscolha(NOVA)
    } finally {
      setCarregandoParc(false)
    }
  }, [])

  useEffect(() => {
    if (!comprovante || !cliente) { setParcelas([]); return }
    void carregarParcelas(cliente.id)
  }, [comprovante, cliente, carregarParcelas])

  async function atribuir() {
    if (!comprovante || !cliente || salvando) return
    if (!escolha) { toastError('Escolha o destino', 'Selecione a parcela ou crie uma cobrança nova.'); return }

    let body: Record<string, unknown>
    if (escolha === NOVA) {
      const valorReais = moedaParaNumero(valor)
      if (!descricao.trim()) { toastError('Descrição obrigatória', 'Descreva a cobrança (ex.: Honorários).'); return }
      if (!valorReais || valorReais <= 0) { toastError('Valor inválido', 'Informe o valor da cobrança.'); return }
      if (!vencimento) { toastError('Vencimento obrigatório', 'Informe a data de vencimento.'); return }
      body = {
        meio,
        clienteId: cliente.id,
        // Sem rota barata de contratos-por-cliente: enviamos sem contratoId (o
        // atendente vincula o contrato depois, se precisar).
        novaCobranca: {
          descricao:     descricao.trim(),
          valorCentavos: Math.round(valorReais * 100),
          vencimento,
        },
      }
    } else {
      // Baixa a parcela aberta escolhida com este comprovante. clienteId é
      // exigido pela rota (schema + match parcela↔cliente), então vai junto.
      body = { meio, clienteId: cliente.id, parcelaId: escolha }
    }

    setSalvando(true)
    try {
      const r = await fetch(`/api/financeiro/comprovantes/${comprovante.id}/atribuir`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const d = await r.json().catch(() => ({}))
      if (!r.ok) {
        toastError('Não foi possível atribuir', mensagemErro(d, 'Tente novamente.'))
        // 409 = parcela já baixada/cancelada ou comprovante já resolvido em
        // outra sessão: a linha está obsoleta -> recarrega e fecha.
        if (r.status === 409) onDone()
        return
      }
      success('Comprovante atribuído', `Baixa registrada — ${cliente.nome}.`)
      onDone()
    } catch {
      toastError('Falha de rede', 'Não foi possível falar com o servidor.')
    } finally {
      setSalvando(false)
    }
  }

  const dados = comprovante?.dados
  const podeAtribuir = Boolean(cliente && escolha)

  return (
    <Dialog
      open={Boolean(comprovante)}
      onClose={onClose}
      title="Atribuir comprovante"
      description={comprovante ? `${formatarValor(dados?.valorCentavos ?? 0)} · ${comprovante.telefone}` : undefined}
      size="lg"
      footer={
        <>
          <Button variant="secondary" size="md" onClick={onClose} disabled={salvando}>Cancelar</Button>
          <Button size="md" onClick={atribuir} loading={salvando} disabled={!podeAtribuir}>
            Atribuir e dar baixa
          </Button>
        </>
      }
    >
      {comprovante && (
        <div className="space-y-4">
          {/* Resumo do que a IA extraiu (contexto para a atribuição). */}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg border border-border bg-muted/20 px-3 py-2 text-sm">
            <span className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              <ScanLine className="h-3.5 w-3.5" aria-hidden /> Extraído
            </span>
            <span className="font-semibold tabular-nums text-foreground">{formatarValor(dados?.valorCentavos ?? 0)}</span>
            <span className="text-muted-foreground">{dados?.dataISO ? formatarData(soData(dados.dataISO)) : '—'}</span>
            {dados?.pagadorNome && <span className="truncate text-muted-foreground">{dados.pagadorNome}</span>}
            {dados?.banco && <span className="truncate text-muted-foreground">{dados.banco}</span>}
          </div>

          {/* Passo 1 — Cliente */}
          <div>
            <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">1. Cliente</p>
            {cliente ? (
              <div className="flex items-center gap-2 rounded-lg border border-border bg-muted/30 px-3 py-2.5 text-sm">
                <User className="h-4 w-4 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1 truncate font-medium text-foreground">{cliente.nome}</span>
                <button
                  type="button"
                  onClick={() => { setCliente(null); setBusca(''); setEscolha('') }}
                  className="rounded-md p-1 text-muted-foreground hover:text-destructive transition-colors"
                  aria-label="Trocar cliente"
                  title="Trocar cliente"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            ) : (
              <div className="relative">
                <Input
                  placeholder="Digite o nome para buscar…"
                  leftIcon={buscando ? <Spinner className="h-4 w-4" /> : <Search className="h-4 w-4" />}
                  value={busca}
                  onChange={(e) => setBusca(e.target.value)}
                  autoFocus
                />
                {resultados.length > 0 && (
                  <ul className="absolute z-10 mt-1 w-full overflow-hidden rounded-lg border border-border bg-card shadow-lg">
                    {resultados.map((c) => (
                      <li key={c.id}>
                        <button
                          type="button"
                          onClick={() => { setCliente(c); setResultados([]) }}
                          className="w-full px-3 py-2 text-left text-sm text-foreground hover:bg-muted/50 transition-colors"
                        >
                          {c.nome}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </div>

          {/* Passo 2 — Destino da baixa */}
          {cliente && (
            <div>
              <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">2. Destino</p>
              {carregandoParc ? (
                <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
                  <Spinner className="h-4 w-4" /> Carregando parcelas em aberto…
                </div>
              ) : (
                <div className="space-y-2">
                  {parcelas.map((p) => (
                    <OpcaoRadio
                      key={p.id}
                      selecionado={escolha === p.id}
                      onSelect={() => setEscolha(p.id)}
                      icone={<Wallet className="h-4 w-4" />}
                      titulo={p.descricao}
                      detalhe={`${formatarValor(p.valor_centavos)} · vence ${formatarData(p.vencimento)}`}
                    />
                  ))}
                  <OpcaoRadio
                    selecionado={escolha === NOVA}
                    onSelect={() => setEscolha(NOVA)}
                    icone={<PlusCircle className="h-4 w-4" />}
                    titulo="Criar nova cobrança"
                    detalhe={parcelas.length === 0 ? 'Nenhuma parcela em aberto para este cliente.' : 'Nova parcela já baixada com este comprovante.'}
                  />

                  {/* Campos da cobrança nova */}
                  {escolha === NOVA && (
                    <div className="space-y-3 rounded-lg border border-border bg-muted/20 p-3">
                      <Input label="Descrição" value={descricao} onChange={(e) => setDescricao(e.target.value)} placeholder="ex.: Honorários" />
                      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                        <Input label="Valor" inputMode="numeric" value={valor} onChange={(e) => setValor(formatarMoedaInput(e.target.value))} placeholder="R$ 0,00" />
                        <Input label="Vencimento" type="date" value={vencimento} onChange={(e) => setVencimento(e.target.value)} />
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Meio de pagamento (aplica à baixa em qualquer caminho). */}
          {cliente && escolha && (
            <div className="w-full sm:w-52">
              <Select
                id="meio-atribuir"
                label="Meio de pagamento"
                value={meio}
                onChange={(e) => setMeio(e.target.value)}
                options={MEIOS}
              />
            </div>
          )}
        </div>
      )}
    </Dialog>
  )
}

// ─────────────────────────────────────────────────────────────
// Opção de radio (parcela existente ou "criar nova")
// ─────────────────────────────────────────────────────────────

function OpcaoRadio({
  selecionado, onSelect, icone, titulo, detalhe,
}: {
  selecionado: boolean
  onSelect: () => void
  icone: React.ReactNode
  titulo: string
  detalhe: string
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selecionado}
      className={cn(
        'flex w-full items-center gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors',
        selecionado ? 'border-primary bg-primary/10' : 'border-border hover:bg-muted/40',
      )}
    >
      <span className={cn('flex h-4 w-4 shrink-0 items-center justify-center rounded-full border', selecionado ? 'border-primary' : 'border-muted-foreground/40')}>
        {selecionado && <span className="h-2 w-2 rounded-full bg-primary" />}
      </span>
      <span className={cn('shrink-0', selecionado ? 'text-primary' : 'text-muted-foreground')}>{icone}</span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-foreground">{titulo}</span>
        <span className="block truncate text-xs text-muted-foreground">{detalhe}</span>
      </span>
    </button>
  )
}
