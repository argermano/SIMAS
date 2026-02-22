'use client'

import { useRouter, useSearchParams } from 'next/navigation'
import { useState, useTransition } from 'react'
import { Search, X } from 'lucide-react'

interface ListaClientesClientProps {
  busca: string
}

export function ListaClientesClient({ busca }: ListaClientesClientProps) {
  const router        = useRouter()
  const searchParams  = useSearchParams()
  const [, startTransition] = useTransition()
  const [valor, setValor]   = useState(busca)

  function pesquisar(e: React.FormEvent) {
    e.preventDefault()
    const params = new URLSearchParams(searchParams.toString())
    if (valor.trim()) {
      params.set('q', valor.trim())
    } else {
      params.delete('q')
    }
    params.delete('page')
    startTransition(() => router.push(`/clientes?${params.toString()}`))
  }

  function limpar() {
    setValor('')
    startTransition(() => router.push('/clientes'))
  }

  return (
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
  )
}
