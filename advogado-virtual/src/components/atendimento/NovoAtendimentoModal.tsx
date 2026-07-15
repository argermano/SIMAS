'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Dialog } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { useToast } from '@/components/ui/toast'
import { VinculoPicker, type VinculoSelecionado } from '@/components/tarefas/VinculoPicker'
import { Plus, X, User, Search, Loader2, UserPlus } from 'lucide-react'

// Nascimento leve do atendimento (056): registrar a conversa inicial ANTES de
// existir peça. Simples e leve — só Assunto, Etiquetas e o 1º Registro.
// A partir do menu global (057) o cliente pode ser buscado ou pré-cadastrado
// só pelo nome, e o atendimento pode ser vinculado a outro caso/processo.
const MAX_ETIQUETAS = 8
const MAX_TAG_LEN = 30

interface NovoAtendimentoModalProps {
  open: boolean
  onClose: () => void
  // Fixado a partir do dossiê do cliente. Ausente = modo global (busca o cliente).
  clienteId?: string
  clienteNome?: string
}

// Cliente escolhido no modo global: id existente OU nome novo (pré-cadastro).
type ClienteEscolhido = { id?: string; nome: string; novo?: boolean }

export function NovoAtendimentoModal({ open, onClose, clienteId, clienteNome }: NovoAtendimentoModalProps) {
  const router = useRouter()
  const { error: toastError } = useToast()

  const clienteFixo = !!clienteId

  const [titulo, setTitulo] = useState('')
  const [etiquetas, setEtiquetas] = useState<string[]>([])
  const [tagInput, setTagInput] = useState('')
  const [registro, setRegistro] = useState('')
  const [salvando, setSalvando] = useState(false)

  // Cliente (modo global): busca assíncrona + opção de criar por nome.
  const [cliente, setCliente] = useState<ClienteEscolhido | null>(
    clienteFixo ? { id: clienteId, nome: clienteNome ?? '' } : null,
  )
  const [buscaCli, setBuscaCli] = useState('')
  const [resultadosCli, setResultadosCli] = useState<{ id: string; nome: string }[]>([])
  const [buscandoCli, setBuscandoCli] = useState(false)
  const [abertoCli, setAbertoCli] = useState(false)
  const seqCli = useRef(0)
  const cliBoxRef = useRef<HTMLDivElement>(null)

  // Fecha o dropdown do cliente ao clicar fora (evita sobrepor o Assunto).
  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (cliBoxRef.current && !cliBoxRef.current.contains(e.target as Node)) setAbertoCli(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [])

  // Vínculo opcional (só outro caso/atendimento ou processo — nunca cliente).
  const [vinculo, setVinculo] = useState<VinculoSelecionado | null>(null)

  // Busca de clientes com debounce (~250ms) — some quando um cliente já foi escolhido.
  useEffect(() => {
    if (clienteFixo || cliente || buscaCli.trim().length < 2) { setResultadosCli([]); return }
    const t = setTimeout(async () => {
      const seq = ++seqCli.current
      setBuscandoCli(true)
      try {
        const r = await fetch(`/api/clientes?q=${encodeURIComponent(buscaCli.trim())}`)
        const d = await r.json().catch(() => ({}))
        if (seq !== seqCli.current) return // resposta obsoleta
        if (r.ok) setResultadosCli(((d.clientes ?? []) as Array<{ id: string; nome: string }>).map((c) => ({ id: c.id, nome: c.nome })))
      } finally {
        if (seq === seqCli.current) setBuscandoCli(false)
      }
    }, 250)
    return () => clearTimeout(t)
  }, [buscaCli, cliente, clienteFixo])

  const podeSalvar = !!cliente && titulo.trim().length > 0 && registro.trim().length > 0 && !salvando

  // "Criar cliente" só aparece se o texto não bate exatamente com um resultado.
  const termo = buscaCli.trim()
  const temExato = resultadosCli.some((c) => c.nome.toLowerCase() === termo.toLowerCase())

  function adicionarEtiqueta() {
    const t = tagInput.trim().slice(0, MAX_TAG_LEN)
    if (!t) return
    setEtiquetas(prev => (prev.length >= MAX_ETIQUETAS || prev.includes(t) ? prev : [...prev, t]))
    setTagInput('')
  }

  function onTagKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault()
      adicionarEtiqueta()
    } else if (e.key === 'Backspace' && !tagInput && etiquetas.length > 0) {
      setEtiquetas(prev => prev.slice(0, -1))
    }
  }

  function fechar() {
    if (salvando) return
    setTitulo('')
    setEtiquetas([])
    setTagInput('')
    setRegistro('')
    setCliente(clienteFixo ? { id: clienteId, nome: clienteNome ?? '' } : null)
    setBuscaCli('')
    setResultadosCli([])
    setVinculo(null)
    onClose()
  }

  async function salvar() {
    if (!podeSalvar || !cliente) return
    setSalvando(true)
    try {
      const res = await fetch('/api/atendimentos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          // cliente_id (existente) XOR cliente_nome (cria pré-cadastro no servidor).
          ...(cliente.id ? { cliente_id: cliente.id } : { cliente_nome: cliente.nome }),
          titulo: titulo.trim(),
          etiquetas,
          estagio: 'atendimento',
          primeiro_registro: registro.trim(),
          // Atendimento leve não exige área: 'geral' = análise multi-área (sem peça definida).
          area: 'geral',
          modo_input: 'texto',
          ...(vinculo ? { vinculo: { tipo: vinculo.tipo, id: vinculo.id } } : {}),
        }),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => null)
        toastError('Não foi possível criar o atendimento', j?.error)
        setSalvando(false)
        return
      }
      const { id, cliente_id } = await res.json()
      // Navega para a Casa do caso — usa o cliente escolhido ou o recém-criado.
      const cid = cliente.id ?? cliente_id
      router.push(`/clientes/${cid}/casos/${id}`)
    } catch {
      toastError('Não foi possível criar o atendimento', 'Verifique a conexão e tente de novo.')
      setSalvando(false)
    }
  }

  return (
    <Dialog
      open={open}
      onClose={fechar}
      title="Novo atendimento"
      description="Registre a conversa inicial com o cliente. Vira caso quando você quiser."
      footer={
        <>
          <Button variant="secondary" size="md" onClick={fechar} disabled={salvando}>
            Cancelar
          </Button>
          <Button size="md" onClick={salvar} loading={salvando} disabled={!podeSalvar}>
            <Plus className="h-4 w-4" />
            Criar atendimento
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        {/* Cliente — fixado (dossiê) ou buscado/pré-cadastrado (menu global) */}
        {clienteFixo ? (
          <div className="flex items-center gap-2 rounded-md bg-muted/50 px-3 py-2 text-sm">
            <User className="h-4 w-4 text-muted-foreground" />
            <span className="text-muted-foreground">Cliente:</span>
            <span className="font-medium text-foreground">{clienteNome}</span>
          </div>
        ) : cliente ? (
          // Cliente escolhido: chip com o nome (X para trocar)
          <div className="space-y-1.5">
            <label className="block text-base font-medium text-foreground">Cliente <span className="text-destructive">*</span></label>
            <div className="flex items-center gap-2 rounded-md border border-border bg-muted/40 px-3 py-2">
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
                {cliente.novo ? <UserPlus className="h-4 w-4" /> : <User className="h-4 w-4" />}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-foreground">{cliente.nome}</p>
                {cliente.novo && <p className="text-xs text-muted-foreground">Novo cliente — poderá ser detalhado depois</p>}
              </div>
              <button
                type="button"
                onClick={() => { setCliente(null); setBuscaCli('') }}
                aria-label="Trocar cliente"
                title="Trocar cliente"
                className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>
        ) : (
          // Busca do cliente + criar por nome
          <div className="space-y-1.5">
            <label className="block text-base font-medium text-foreground">Cliente <span className="text-destructive">*</span></label>
            <div className="relative">
              <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">
                {buscandoCli ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
              </span>
              <input
                value={buscaCli}
                onChange={e => setBuscaCli(e.target.value)}
                placeholder="Buscar cliente pelo nome…"
                autoFocus
                className="h-9 w-full rounded-md border border-border bg-background pl-9 pr-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              />
              {(resultadosCli.length > 0 || (termo.length >= 2 && !temExato)) && (
                <div className="absolute z-20 mt-1 max-h-60 w-full overflow-auto rounded-lg border border-border bg-card shadow-lg">
                  {resultadosCli.map(c => (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => setCliente({ id: c.id, nome: c.nome })}
                      className="flex w-full items-center gap-2.5 px-3 py-2 text-left hover:bg-muted transition-colors"
                    >
                      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
                        <User className="h-4 w-4" />
                      </span>
                      <span className="block truncate text-sm font-medium text-foreground">{c.nome}</span>
                    </button>
                  ))}
                  {termo.length >= 2 && !temExato && (
                    <button
                      type="button"
                      onClick={() => setCliente({ nome: termo, novo: true })}
                      className="flex w-full items-center gap-2.5 border-t border-border px-3 py-2 text-left hover:bg-muted transition-colors"
                    >
                      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
                        <UserPlus className="h-4 w-4" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium text-foreground">Criar cliente “{termo}”</span>
                        <span className="block text-xs text-muted-foreground">Pré-cadastro — poderá ser detalhado depois</span>
                      </span>
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>
        )}

        <Input
          label="Assunto"
          required
          value={titulo}
          onChange={e => setTitulo(e.target.value)}
          maxLength={200}
          placeholder="Ex.: Aposentadoria por idade — dúvidas iniciais"
          autoFocus={clienteFixo}
        />

        {/* Etiquetas: chips digitáveis (Enter adiciona, X remove) */}
        <div>
          <label className="block text-base font-medium text-foreground mb-1.5">Etiquetas</label>
          <div className="flex flex-wrap items-center gap-1.5 rounded-md border border-input bg-background px-2 py-2 focus-within:ring-2 focus-within:ring-ring">
            {etiquetas.map(t => (
              <span
                key={t}
                className="inline-flex items-center gap-1 rounded-full bg-muted px-2.5 py-1 text-sm text-muted-foreground"
              >
                {t}
                <button
                  type="button"
                  onClick={() => setEtiquetas(prev => prev.filter(x => x !== t))}
                  className="rounded-full text-muted-foreground hover:text-foreground transition-colors"
                  aria-label={`Remover etiqueta ${t}`}
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </span>
            ))}
            {etiquetas.length < MAX_ETIQUETAS && (
              <input
                value={tagInput}
                onChange={e => setTagInput(e.target.value)}
                onKeyDown={onTagKeyDown}
                onBlur={adicionarEtiqueta}
                maxLength={MAX_TAG_LEN}
                placeholder={etiquetas.length ? 'Adicionar…' : 'Digite e tecle Enter (ex.: aposentadoria)'}
                className="flex-1 min-w-[8rem] bg-transparent px-1 py-0.5 text-base outline-none placeholder:text-muted-foreground"
              />
            )}
          </div>
          <p className="mt-1 text-sm text-muted-foreground">Enter adiciona · até {MAX_ETIQUETAS} etiquetas</p>
        </div>

        <Textarea
          label="Primeiro registro"
          required
          value={registro}
          onChange={e => setRegistro(e.target.value)}
          maxLength={8000}
          rows={5}
          placeholder="Anotações da conversa com o cliente..."
        />

        {/* Vínculo opcional — outro caso/atendimento ou processo (nunca cliente) */}
        <VinculoPicker
          label="Caso, atendimento ou processo"
          value={vinculo}
          onChange={setVinculo}
          tipos={['atendimento', 'processo']}
        />
      </div>
    </Dialog>
  )
}

// Botão + modal auto-contidos: permite acionar o nascimento leve a partir de
// um Server Component (a página do cliente) sem torná-la client.
export function NovoAtendimentoButton({ clienteId, clienteNome }: { clienteId: string; clienteNome: string }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <Button size="md" onClick={() => setOpen(true)}>
        <Plus className="h-4 w-4" />
        Novo Atendimento
      </Button>
      {open && (
        <NovoAtendimentoModal
          open={open}
          onClose={() => setOpen(false)}
          clienteId={clienteId}
          clienteNome={clienteNome}
        />
      )}
    </>
  )
}

// Versão global (menu Atendimentos): sem cliente pré-fixado — o modal busca ou
// pré-cadastra o cliente pelo nome.
export function NovoAtendimentoGlobalButton() {
  const [open, setOpen] = useState(false)
  return (
    <>
      <Button size="md" onClick={() => setOpen(true)}>
        <Plus className="h-4 w-4" />
        Novo atendimento
      </Button>
      {open && <NovoAtendimentoModal open={open} onClose={() => setOpen(false)} />}
    </>
  )
}
