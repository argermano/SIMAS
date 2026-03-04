'use client'

import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import { Search, X } from 'lucide-react'

interface FiltroContratosClientProps {
  busca: string
  statusAtivo: string
}

const STATUS_OPTIONS = [
  { value: '',           label: 'Todos' },
  { value: 'rascunho',   label: 'Rascunho' },
  { value: 'em_revisao', label: 'Em revisão' },
  { value: 'aprovado',   label: 'Aprovado' },
  { value: 'exportado',  label: 'Exportado' },
]

export function FiltroContratosClient({ busca, statusAtivo }: FiltroContratosClientProps) {
  const router = useRouter()
  const [, startTransition] = useTransition()
  const [valor, setValor] = useState(busca)

  function pesquisar(e: React.FormEvent) {
    e.preventDefault()
    const params = new URLSearchParams()
    if (valor.trim()) params.set('q', valor.trim())
    if (statusAtivo) params.set('status', statusAtivo)
    startTransition(() => router.push(`/contratos?${params.toString()}`))
  }

  function limpar() {
    setValor('')
    const params = new URLSearchParams()
    if (statusAtivo) params.set('status', statusAtivo)
    startTransition(() => router.push(`/contratos?${params.toString()}`))
  }

  function selecionarStatus(status: string) {
    const params = new URLSearchParams()
    if (valor.trim()) params.set('q', valor.trim())
    if (status) params.set('status', status)
    startTransition(() => router.push(`/contratos?${params.toString()}`))
  }

  return (
    <div className="space-y-3">
      {/* Barra de busca */}
      <form onSubmit={pesquisar} className="flex gap-2">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground" />
          <input
            type="search"
            value={valor}
            onChange={e => setValor(e.target.value)}
            placeholder="Buscar contrato por título ou cliente..."
            className="h-11 w-full rounded-md border border-border bg-card py-2 pl-10 pr-10 text-base placeholder:text-muted-foreground focus:border-transparent focus:outline-none focus:ring-2 focus:ring-ring hover:border-muted-foreground transition-colors"
            aria-label="Buscar contratos"
          />
          {valor && (
            <button
              type="button"
              onClick={limpar}
              className="absolute right-3 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted-foreground hover:text-muted-foreground"
              aria-label="Limpar busca"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
        <button
          type="submit"
          className="h-11 rounded-md bg-primary px-5 text-base font-semibold text-white hover:bg-primary/90 transition-colors"
        >
          Buscar
        </button>
      </form>

      {/* Filtro por status */}
      <div className="flex items-center gap-1">
        {STATUS_OPTIONS.map(opt => (
          <button
            key={opt.value}
            onClick={() => selecionarStatus(opt.value)}
            className={`px-3 py-1 text-xs font-semibold rounded-full transition-colors ${
              statusAtivo === opt.value
                ? 'bg-primary text-white'
                : 'text-muted-foreground hover:bg-muted'
            }`}
          >
            {opt.label}
          </button>
        ))}
      </div>
    </div>
  )
}
