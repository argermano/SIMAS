'use client'

import { useRouter, useSearchParams } from 'next/navigation'
import { useState, useTransition } from 'react'
import { Search, X } from 'lucide-react'

const LETRAS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('')

interface ListaClientesClientProps {
  busca: string
  letraAtiva: string
  letrasDisponiveis: string[]
}

export function ListaClientesClient({ busca, letraAtiva, letrasDisponiveis }: ListaClientesClientProps) {
  const router        = useRouter()
  const searchParams  = useSearchParams()
  const [, startTransition] = useTransition()
  const [valor, setValor]   = useState(busca)

  function pesquisar(e: React.FormEvent) {
    e.preventDefault()
    const params = new URLSearchParams()
    if (valor.trim()) {
      params.set('q', valor.trim())
    }
    startTransition(() => router.push(`/clientes?${params.toString()}`))
  }

  function limpar() {
    setValor('')
    startTransition(() => router.push(`/clientes${letraAtiva ? `?letra=${letraAtiva}` : ''}`))
  }

  function selecionarLetra(letra: string) {
    setValor('')
    const params = new URLSearchParams()
    if (letra) {
      params.set('letra', letra)
    }
    startTransition(() => router.push(`/clientes?${params.toString()}`))
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
            placeholder="Buscar cliente pelo nome..."
            className="h-11 w-full rounded-md border border-border bg-card py-2 pl-10 pr-10 text-base placeholder:text-muted-foreground focus:border-transparent focus:outline-none focus:ring-2 focus:ring-ring hover:border-muted-foreground transition-colors"
            aria-label="Buscar clientes"
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

      {/* Índice alfabético */}
      {!busca && (
        <div className="flex items-center gap-0.5">
          <button
            onClick={() => selecionarLetra('')}
            className={`shrink-0 px-1.5 py-0.5 text-xs font-semibold rounded transition-colors ${
              !letraAtiva
                ? 'bg-primary text-white'
                : 'text-muted-foreground hover:bg-muted'
            }`}
          >
            Todos
          </button>
          <span className="mx-0.5 h-4 w-px bg-border" />
          {LETRAS.map(letra => {
            const disponivel = letrasDisponiveis.includes(letra)
            return (
              <button
                key={letra}
                onClick={() => disponivel && selecionarLetra(letra)}
                disabled={!disponivel}
                className={`w-6 h-6 text-xs font-semibold rounded transition-colors ${
                  letraAtiva === letra
                    ? 'bg-primary text-white'
                    : disponivel
                      ? 'text-foreground hover:bg-muted'
                      : 'text-border cursor-default'
                }`}
              >
                {letra}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
