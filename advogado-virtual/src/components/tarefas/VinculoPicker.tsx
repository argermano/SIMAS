'use client'

import { useEffect, useRef, useState } from 'react'
import { Search, X, User, Briefcase, Scale, Loader2, Link2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { ROTULO_TIPO, type VinculoTipo } from '@/lib/tarefas/vinculo'

// Vínculo já resolvido (com rótulo) — o que o form/detalhe guardam e enviam.
export interface VinculoSelecionado {
  tipo:      VinculoTipo
  id:        string
  label:     string
  sublabel?: string | null
}

interface Resultado {
  tipo:     VinculoTipo
  id:       string
  label:    string
  sublabel: string | null
}

const ICONE: Record<VinculoTipo, typeof User> = {
  cliente:     User,
  atendimento: Briefcase,
  processo:    Scale,
}

function IconeTipo({ tipo, className }: { tipo: VinculoTipo; className?: string }) {
  const Icon = ICONE[tipo]
  return <Icon className={className} />
}

// Linha clicável de uma opção (resultado de busca OU sugestão) — mesmo visual.
function OpcaoBotao({
  item, onPick,
}: {
  item: { tipo: VinculoTipo; id: string; label: string; sublabel?: string | null }
  onPick: (r: { tipo: VinculoTipo; id: string; label: string; sublabel: string | null }) => void
}) {
  return (
    <button
      type="button"
      onClick={() => onPick({ tipo: item.tipo, id: item.id, label: item.label, sublabel: item.sublabel ?? null })}
      className="flex w-full items-center gap-2.5 px-3 py-2 text-left hover:bg-muted transition-colors"
    >
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
        <IconeTipo tipo={item.tipo} className="h-4 w-4" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-foreground">{item.label}</span>
        <span className="block truncate text-xs text-muted-foreground">
          {ROTULO_TIPO[item.tipo]}{item.sublabel ? ` · ${item.sublabel}` : ''}
        </span>
      </span>
    </button>
  )
}

interface VinculoPickerProps {
  value:     VinculoSelecionado | null
  onChange:  (v: VinculoSelecionado | null) => void
  label?:    string
  /** Chip discreto para vínculo cuja entidade foi removida (só rótulo, sem clear-desfoco). */
  removido?: boolean
  /** Restringe os tipos buscados (repassado ao endpoint). Ausente = os 3 tipos. */
  tipos?:    VinculoTipo[]
  /** Escopa a busca aos casos deste cliente (repassado ao endpoint como clienteId). */
  clienteId?: string
  /** Opções pré-resolvidas exibidas ANTES de digitar (casos do cliente / matches por nome). */
  sugestoes?: VinculoSelecionado[]
  /** Oculta o marcador "(opcional)" do rótulo (contexto onde o vínculo é o objetivo). */
  hintOpcional?: boolean
}

export function VinculoPicker({
  value, onChange, label = 'Cliente, caso ou processo', removido, tipos,
  clienteId, sugestoes, hintOpcional = true,
}: VinculoPickerProps) {
  const [busca,      setBusca]      = useState('')
  const [resultados, setResultados] = useState<Resultado[]>([])
  const [buscando,   setBuscando]   = useState(false)
  const [aberto,     setAberto]     = useState(false)
  const boxRef = useRef<HTMLDivElement>(null)
  const seqRef = useRef(0) // ordem das buscas: descarta resposta que chegar fora de ordem

  // Chave estável dos tipos p/ deps (array inline do pai muda de referência a cada render).
  const tiposParam = tipos && tipos.length ? tipos.join(',') : ''

  // Busca assíncrona com debounce (~250ms). Mín. 2 chars.
  useEffect(() => {
    if (value || busca.trim().length < 2) { setResultados([]); return }
    const t = setTimeout(async () => {
      const seq = ++seqRef.current
      setBuscando(true)
      try {
        const params = new URLSearchParams({ q: busca.trim() })
        if (tiposParam) params.set('tipos', tiposParam)
        if (clienteId) params.set('clienteId', clienteId)
        const r = await fetch(`/api/tarefas/vinculos?${params.toString()}`)
        const d = await r.json().catch(() => ({}))
        if (seq !== seqRef.current) return // já saiu uma busca mais nova: ignora esta resposta obsoleta
        if (r.ok) { setResultados((d.resultados ?? []) as Resultado[]); setAberto(true) }
      } finally {
        if (seq === seqRef.current) setBuscando(false)
      }
    }, 250)
    return () => clearTimeout(t)
  }, [busca, value, tiposParam, clienteId])

  // Fecha o dropdown ao clicar fora.
  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setAberto(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [])

  function selecionar(r: Resultado) {
    onChange({ tipo: r.tipo, id: r.id, label: r.label, sublabel: r.sublabel })
    setBusca('')
    setResultados([])
    setAberto(false)
  }

  function limpar() {
    onChange(null)
    setBusca('')
  }

  // Sugestões (casos do cliente / matches por nome) só aparecem antes de digitar
  // e quando não há resultados de busca ativos — não competem com o que se digita.
  const mostrarSugestoes = !value && busca.trim().length < 2 && (sugestoes?.length ?? 0) > 0 && resultados.length === 0

  return (
    <div className="space-y-1.5" ref={boxRef}>
      <label className="flex items-center gap-1.5 text-sm font-medium text-foreground">
        <Link2 className="h-3.5 w-3.5 text-muted-foreground" />
        {label}
        {hintOpcional && <span className="text-xs font-normal text-muted-foreground">(opcional)</span>}
      </label>

      {value ? (
        // ── Chip do vínculo selecionado ──
        <div
          className={cn(
            'flex items-center gap-2 rounded-lg border px-3 py-2',
            removido ? 'border-dashed border-border bg-muted/40 text-muted-foreground' : 'border-border bg-muted/40',
          )}
        >
          <span className={cn(
            'flex h-7 w-7 shrink-0 items-center justify-center rounded-md',
            removido ? 'bg-muted text-muted-foreground' : 'bg-primary/10 text-primary',
          )}>
            <IconeTipo tipo={value.tipo} className="h-4 w-4" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-foreground">{value.label}</p>
            <p className="truncate text-xs text-muted-foreground">
              {ROTULO_TIPO[value.tipo]}{value.sublabel ? ` · ${value.sublabel}` : ''}
            </p>
          </div>
          <button
            type="button"
            onClick={limpar}
            aria-label="Remover vínculo"
            title="Remover vínculo"
            className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      ) : (
        // ── Campo de busca + dropdown ──
        <div className="relative">
          <div className="relative">
            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">
              {buscando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
            </span>
            <input
              value={busca}
              onChange={e => setBusca(e.target.value)}
              onFocus={() => { if (resultados.length || mostrarSugestoes) setAberto(true) }}
              placeholder="Buscar cliente, caso ou processo…"
              className="h-9 w-full rounded-md border border-border bg-background pl-9 pr-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>

          {aberto && (resultados.length > 0 || mostrarSugestoes || (busca.trim().length >= 2 && !buscando)) && (
            <div className="absolute z-20 mt-1 max-h-64 w-full overflow-auto rounded-lg border border-border bg-card shadow-lg">
              {mostrarSugestoes ? (
                <>
                  <p className="px-3 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Sugestões</p>
                  {sugestoes!.map(s => <OpcaoBotao key={`sug:${s.tipo}:${s.id}`} item={s} onPick={selecionar} />)}
                </>
              ) : resultados.length === 0 ? (
                <p className="px-3 py-3 text-sm text-muted-foreground">Nada encontrado.</p>
              ) : (
                resultados.map(r => <OpcaoBotao key={`${r.tipo}:${r.id}`} item={r} onPick={selecionar} />)
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
