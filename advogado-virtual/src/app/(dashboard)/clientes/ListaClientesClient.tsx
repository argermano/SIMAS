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
          <Search className="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-gray-400" />
          <input
            type="search"
            value={valor}
            onChange={e => setValor(e.target.value)}
            placeholder="Buscar cliente pelo nome..."
            className="h-11 w-full rounded-md border border-gray-300 bg-white py-2 pl-10 pr-10 text-base placeholder:text-gray-400 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-primary-800 hover:border-gray-400 transition-colors"
            aria-label="Buscar clientes"
          />
          {valor && (
            <button
              type="button"
              onClick={limpar}
              className="absolute right-3 top-1/2 -translate-y-1/2 rounded p-0.5 text-gray-400 hover:text-gray-600"
              aria-label="Limpar busca"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
        <button
          type="submit"
          className="h-11 rounded-md bg-primary-800 px-5 text-base font-semibold text-white hover:bg-primary-900 transition-colors"
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
                ? 'bg-primary-800 text-white'
                : 'text-gray-600 hover:bg-gray-100'
            }`}
          >
            Todos
          </button>
          <span className="mx-0.5 h-4 w-px bg-gray-200" />
          {LETRAS.map(letra => {
            const disponivel = letrasDisponiveis.includes(letra)
            return (
              <button
                key={letra}
                onClick={() => disponivel && selecionarLetra(letra)}
                disabled={!disponivel}
                className={`w-6 h-6 text-xs font-semibold rounded transition-colors ${
                  letraAtiva === letra
                    ? 'bg-primary-800 text-white'
                    : disponivel
                      ? 'text-gray-700 hover:bg-gray-100'
                      : 'text-gray-300 cursor-default'
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
