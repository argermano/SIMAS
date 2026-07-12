'use client'

// Chip "Outra…" — permite ao advogado DIGITAR uma peça fora do catálogo fixo.
// Vira input inline e navega para o slug reservado /{area}/pecas/outra?nome=...,
// que flui como tipo livre ao gerar-peca (prompt genérico).
import { useState, useRef, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { Plus, ArrowRight, X } from 'lucide-react'

interface OutraPecaChipProps {
  area: string
  atendimentoId?: string
}

export function OutraPecaChip({ area, atendimentoId }: OutraPecaChipProps) {
  const router = useRouter()
  const [aberto, setAberto] = useState(false)
  const [nome, setNome] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  // Foca o input assim que o chip vira campo
  useEffect(() => {
    if (aberto) inputRef.current?.focus()
  }, [aberto])

  const valido = nome.trim().length >= 3

  function gerar() {
    const limpo = nome.trim()
    if (limpo.length < 3) return
    const params = new URLSearchParams({ nome: limpo })
    if (atendimentoId) params.set('id', atendimentoId) // vincula ao caso quando houver
    router.push(`/${area}/pecas/outra?${params.toString()}`)
  }

  function fechar() {
    setAberto(false)
    setNome('')
  }

  if (!aberto) {
    return (
      <button
        type="button"
        onClick={() => setAberto(true)}
        className="flex items-center gap-1.5 rounded-lg border border-dashed bg-card px-3 py-1.5 text-sm font-medium text-muted-foreground hover:border-primary/40 hover:bg-primary/10 hover:text-primary transition-colors"
      >
        <Plus className="h-3.5 w-3.5" />
        Outra…
      </button>
    )
  }

  return (
    <div className="flex items-center gap-1.5">
      <input
        ref={inputRef}
        value={nome}
        onChange={(e) => setNome(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { e.preventDefault(); gerar() }       // Enter confirma
          else if (e.key === 'Escape') { e.preventDefault(); fechar() } // Esc cancela
        }}
        maxLength={80}
        placeholder="Qual peça? ex.: Embargos de Terceiro"
        className="h-9 w-64 max-w-full rounded-lg border border-input bg-background px-3 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:border-transparent"
      />
      <button
        type="button"
        onClick={gerar}
        disabled={!valido}
        className="flex items-center gap-1 rounded-lg border bg-card px-3 py-1.5 text-sm font-medium text-primary hover:border-primary/30 hover:bg-primary/10 transition-colors disabled:opacity-50 disabled:pointer-events-none"
      >
        Gerar <ArrowRight className="h-3.5 w-3.5" />
      </button>
      <button
        type="button"
        onClick={fechar}
        aria-label="Cancelar"
        className="flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted transition-colors"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  )
}
