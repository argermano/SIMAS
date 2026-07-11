'use client'

import { useEffect, useMemo, useState } from 'react'
import { Search, User, X, FileSignature } from 'lucide-react'
import { Dialog } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Spinner } from '@/components/ui/spinner'
import { useToast } from '@/components/ui/toast'
import { cn, formatarMoedaInput, moedaParaNumero, formatarData } from '@/lib/utils'
import { gerarSerie, formatarValor, type ItemSerie } from '@/lib/financeiro/parcelas'
import { hojeISO } from './tipos'

export interface PrefillContrato {
  contratoId: string
  clienteId: string | null
  clienteNome: string | null
  valorCentavos: number | null
  formaPagamento: string | null
}

interface ClienteLeve { id: string; nome: string }
interface ProcessoLeve { id: string; numero_cnj: string; apelido?: string | null }

interface ModalNovaCobrancaProps {
  open: boolean
  prefill: PrefillContrato | null
  onClose: () => void
  onDone: () => void
}

export function ModalNovaCobranca({ open, prefill, onClose, onDone }: ModalNovaCobrancaProps) {
  const { success, error: toastError } = useToast()

  // Cliente (busca leve)
  const [busca, setBusca]           = useState('')
  const [buscando, setBuscando]     = useState(false)
  const [resultados, setResultados] = useState<ClienteLeve[]>([])
  const [cliente, setCliente]       = useState<ClienteLeve | null>(null)

  // Vínculo opcional com processo do cliente
  const [processos, setProcessos]   = useState<ProcessoLeve[]>([])
  const [processoId, setProcessoId] = useState('')

  // Tipo e campos
  const [tipo, setTipo] = useState<'avulsa' | 'serie'>('avulsa')
  const [descricao, setDescricao]     = useState('Honorários')
  const [valorAvulsa, setValorAvulsa] = useState('')
  const [vencAvulsa, setVencAvulsa]   = useState(hojeISO())
  const [valorTotal, setValorTotal]   = useState('')
  const [entrada, setEntrada]         = useState('')
  const [numParcelas, setNumParcelas] = useState('2')
  const [primeiroVenc, setPrimeiroVenc] = useState(hojeISO())
  const [diaFixo, setDiaFixo]         = useState('')
  const [salvando, setSalvando]       = useState(false)

  // Reset + prefill quando abre
  useEffect(() => {
    if (!open) return
    setBusca('')
    setResultados([])
    setProcessoId('')
    setDescricao('Honorários')
    setValorAvulsa('')
    setVencAvulsa(hojeISO())
    setEntrada('')
    setNumParcelas('2')
    setPrimeiroVenc(hojeISO())
    setDiaFixo('')
    if (prefill) {
      setCliente(prefill.clienteId ? { id: prefill.clienteId, nome: prefill.clienteNome ?? 'Cliente' } : null)
      const valor = prefill.valorCentavos ? formatarMoedaInput(String(prefill.valorCentavos)) : ''
      setValorTotal(valor)
      setValorAvulsa(valor)
      setTipo('serie')
    } else {
      setCliente(null)
      setValorTotal('')
      setTipo('avulsa')
    }
  }, [open, prefill])

  // Busca leve de clientes (debounce simples)
  useEffect(() => {
    if (!open || cliente || busca.trim().length < 2) { setResultados([]); return }
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
  }, [busca, open, cliente])

  // Processos do cliente selecionado (vínculo opcional)
  useEffect(() => {
    if (!open || !cliente) { setProcessos([]); return }
    let vivo = true
    fetch(`/api/clientes/${cliente.id}/processos`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (vivo && d) setProcessos((d.processos ?? []) as ProcessoLeve[]) })
      .catch(() => {})
    return () => { vivo = false }
  }, [open, cliente])

  // Preview da série (client-side, com a MESMA lib usada no servidor)
  const preview: ItemSerie[] | null = useMemo(() => {
    if (tipo !== 'serie') return null
    const total = moedaParaNumero(valorTotal)
    const n = parseInt(numParcelas, 10)
    if (!total || total <= 0 || !n || n < 1 || !primeiroVenc) return null
    try {
      return gerarSerie({
        valorTotalCentavos: Math.round(total * 100),
        entradaCentavos:    entrada ? Math.round((moedaParaNumero(entrada) ?? 0) * 100) || undefined : undefined,
        numParcelas:        n,
        primeiroVencimento: primeiroVenc,
        diaFixo:            diaFixo ? parseInt(diaFixo, 10) : undefined,
      })
    } catch {
      return null
    }
  }, [tipo, valorTotal, entrada, numParcelas, primeiroVenc, diaFixo])

  async function salvar() {
    if (!cliente) { toastError('Selecione o cliente', 'Busque pelo nome para vincular a cobrança.'); return }

    let body: Record<string, unknown>
    if (tipo === 'avulsa') {
      const valor = moedaParaNumero(valorAvulsa)
      if (!descricao.trim()) { toastError('Descrição obrigatória', 'Descreva a cobrança (ex.: Honorários iniciais).'); return }
      if (!valor || valor <= 0) { toastError('Valor inválido', 'Informe o valor da cobrança.'); return }
      if (!vencAvulsa) { toastError('Vencimento obrigatório', 'Informe a data de vencimento.'); return }
      body = {
        clienteId: cliente.id,
        avulsa: {
          descricao:     descricao.trim(),
          valorCentavos: Math.round(valor * 100),
          vencimento:    vencAvulsa,
        },
      }
    } else {
      if (!preview || preview.length === 0) {
        toastError('Série incompleta', 'Preencha valor total, número de parcelas e primeiro vencimento.')
        return
      }
      const total = moedaParaNumero(valorTotal)!
      body = {
        clienteId: cliente.id,
        serie: {
          valorTotalCentavos: Math.round(total * 100),
          entradaCentavos:    entrada ? Math.round((moedaParaNumero(entrada) ?? 0) * 100) || undefined : undefined,
          numParcelas:        parseInt(numParcelas, 10),
          primeiroVencimento: primeiroVenc,
          diaFixo:            diaFixo ? parseInt(diaFixo, 10) : undefined,
        },
      }
    }
    if (prefill?.contratoId) body.contratoId = prefill.contratoId
    if (processoId) body.processoId = processoId

    setSalvando(true)
    try {
      const r = await fetch('/api/financeiro/parcelas', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const d = await r.json().catch(() => ({}))
      if (!r.ok) { toastError('Não foi possível criar a cobrança', d.error ?? 'Tente novamente.'); return }
      success(
        'Cobrança criada',
        tipo === 'serie' ? `${preview!.length} parcela${preview!.length === 1 ? '' : 's'} para ${cliente.nome}.` : `${descricao.trim()} — ${cliente.nome}.`
      )
      onDone()
    } catch {
      toastError('Falha de rede', 'Não foi possível falar com o servidor.')
    } finally {
      setSalvando(false)
    }
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Nova cobrança"
      description="Cobrança avulsa ou série de parcelas de honorários."
      size="lg"
      footer={
        <>
          <Button variant="secondary" size="md" onClick={onClose} disabled={salvando}>Cancelar</Button>
          <Button size="md" onClick={salvar} loading={salvando}>
            {tipo === 'serie' && preview ? `Criar ${preview.length} parcela${preview.length === 1 ? '' : 's'}` : 'Criar cobrança'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {/* Origem: contrato (deep-link da tarefa) */}
        {prefill?.contratoId && (
          <div className="flex items-center gap-2 rounded-lg border border-info/30 bg-info/5 px-3 py-2 text-sm text-foreground">
            <FileSignature className="h-4 w-4 shrink-0 text-info" />
            <span>
              A partir do contrato assinado
              {prefill.formaPagamento ? <> — forma combinada: <strong>{prefill.formaPagamento}</strong></> : null}
            </span>
          </div>
        )}

        {/* Cliente */}
        {cliente ? (
          <div className="flex items-center gap-2 rounded-lg border border-border bg-muted/30 px-3 py-2.5 text-sm">
            <User className="h-4 w-4 shrink-0 text-muted-foreground" />
            <span className="min-w-0 flex-1 truncate font-medium text-foreground">{cliente.nome}</span>
            <button
              type="button"
              onClick={() => { setCliente(null); setBusca(''); setProcessoId('') }}
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
              label="Cliente"
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

        {/* Vínculo opcional com processo */}
        {cliente && processos.length > 0 && (
          <Select
            label="Processo (opcional)"
            value={processoId}
            onChange={(e) => setProcessoId(e.target.value)}
            options={[
              { value: '', label: 'Sem vínculo' },
              ...processos.map((p) => ({ value: p.id, label: p.apelido || p.numero_cnj })),
            ]}
          />
        )}

        {/* Tipo */}
        <div className="flex gap-2">
          {(['avulsa', 'serie'] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTipo(t)}
              aria-pressed={tipo === t}
              className={cn(
                'flex-1 rounded-lg border px-3 py-2 text-sm font-medium transition-colors',
                tipo === t
                  ? 'border-primary bg-primary/10 text-primary'
                  : 'border-border text-muted-foreground hover:bg-muted/40'
              )}
            >
              {t === 'avulsa' ? 'Cobrança avulsa' : 'Série de parcelas'}
            </button>
          ))}
        </div>

        {tipo === 'avulsa' ? (
          <div className="space-y-3">
            <Input label="Descrição" value={descricao} onChange={(e) => setDescricao(e.target.value)} placeholder="ex.: Honorários iniciais" />
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Input label="Valor" inputMode="numeric" value={valorAvulsa} onChange={(e) => setValorAvulsa(formatarMoedaInput(e.target.value))} placeholder="R$ 0,00" />
              <Input label="Vencimento" type="date" value={vencAvulsa} onChange={(e) => setVencAvulsa(e.target.value)} />
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Input label="Valor total" inputMode="numeric" value={valorTotal} onChange={(e) => setValorTotal(formatarMoedaInput(e.target.value))} placeholder="R$ 0,00" />
              <Input label="Entrada (opcional)" inputMode="numeric" value={entrada} onChange={(e) => setEntrada(formatarMoedaInput(e.target.value))} placeholder="R$ 0,00" hint="Vence na primeira data; as parcelas começam um mês depois." />
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <Input label="Nº de parcelas" type="number" min={1} max={48} value={numParcelas} onChange={(e) => setNumParcelas(e.target.value)} />
              <Input label="Primeiro vencimento" type="date" value={primeiroVenc} onChange={(e) => setPrimeiroVenc(e.target.value)} />
              <Input label="Dia fixo (opcional)" type="number" min={1} max={31} value={diaFixo} onChange={(e) => setDiaFixo(e.target.value)} placeholder="ex.: 10" />
            </div>

            {/* Preview da série antes de salvar */}
            {preview && preview.length > 0 && (
              <div className="rounded-lg border border-border bg-muted/20">
                <p className="border-b border-border px-3 py-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Preview — {preview.length} lançamento{preview.length === 1 ? '' : 's'}
                </p>
                <ul className="max-h-48 divide-y divide-border/60 overflow-y-auto">
                  {preview.map((item, i) => (
                    <li key={i} className="flex items-center justify-between gap-3 px-3 py-1.5 text-sm">
                      <span className="min-w-0 truncate text-muted-foreground">{item.descricao}</span>
                      <span className="shrink-0 tabular-nums text-muted-foreground">{formatarData(item.vencimento)}</span>
                      <span className="w-24 shrink-0 text-right font-medium tabular-nums text-foreground">{formatarValor(item.valor_centavos)}</span>
                    </li>
                  ))}
                </ul>
                <p className="border-t border-border px-3 py-2 text-right text-sm font-semibold tabular-nums text-foreground">
                  Total: {formatarValor(preview.reduce((s, x) => s + x.valor_centavos, 0))}
                </p>
              </div>
            )}
          </div>
        )}
      </div>
    </Dialog>
  )
}
