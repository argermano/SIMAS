'use client'

import { useEffect, useRef, useState } from 'react'
import { Link2, Search, UserRound } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Spinner } from '@/components/ui/spinner'
import { useToast } from '@/components/ui/toast'
import { cn } from '@/lib/utils'

interface ClienteBusca {
  id: string
  nome: string
}

/**
 * Picker de cliente para vincular o processo de uma publicação ÓRFÃ (numero com
 * 20 dígitos, sem processo cadastrado). Fluxo: digita → GET /api/clientes?q=
 * (debounce) → clica num resultado → POST /api/clientes/{id}/processos { numero }.
 * O POST já sincroniza o snapshot (movimentos) e RELIGA as publicações do mesmo
 * número (esta e as irmãs recebem processo_id). Segue o visual do VincularCliente
 * das Conversas. `onVinculado` recebe o resumo p/ o pai recarregar lista/painel.
 */
export function VincularProcessoPublicacao({
  numeroProcesso,
  onVinculado,
}: {
  numeroProcesso: string
  onVinculado: () => void
}) {
  const { success, error: toastError } = useToast()

  const [q, setQ] = useState('')
  const [resultados, setResultados] = useState<ClienteBusca[]>([])
  const [buscando, setBuscando] = useState(false)
  const [buscou, setBuscou] = useState(false)
  const [vinculandoId, setVinculandoId] = useState<string | null>(null)

  // Descarta respostas de buscas antigas (evita flicker de resultado atrasado).
  const buscaSeq = useRef(0)

  // Busca com debounce (300ms) a partir de 2 caracteres.
  useEffect(() => {
    const termo = q.trim()
    if (termo.length < 2) {
      setResultados([])
      setBuscando(false)
      setBuscou(false)
      return
    }
    setBuscando(true)
    const seq = ++buscaSeq.current
    const timer = setTimeout(async () => {
      try {
        const r = await fetch(`/api/clientes?q=${encodeURIComponent(termo)}`)
        const d = await r.json().catch(() => ({}))
        if (seq !== buscaSeq.current) return
        const lista = (d as { clientes?: ClienteBusca[] }).clientes
        setResultados(Array.isArray(lista) ? lista : [])
        setBuscou(true)
      } catch {
        if (seq !== buscaSeq.current) return
        setResultados([])
        setBuscou(true)
      } finally {
        if (seq === buscaSeq.current) setBuscando(false)
      }
    }, 300)
    return () => clearTimeout(timer)
  }, [q])

  async function vincular(cliente: ClienteBusca) {
    setVinculandoId(cliente.id)
    try {
      const r = await fetch(`/api/clientes/${cliente.id}/processos`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ numero: numeroProcesso }),
      })
      const d = await r.json().catch(() => ({}))
      if (!r.ok) {
        toastError('Não foi possível vincular', (d as { error?: string }).error ?? 'Tente novamente.')
        return
      }
      const parteMov = d.sincronizado
        ? `${d.novosMovimentos ?? 0} movimentação(ões) importada(s).`
        : 'A sincronização automática ocorrerá em breve.'
      const parteReligadas = d.publicacoesReligadas > 0
        ? ` ${d.publicacoesReligadas} publicação(ões) vinculada(s).`
        : ''
      success(`Processo vinculado a ${cliente.nome}`, parteMov + parteReligadas)
      onVinculado()
    } catch {
      toastError('Não foi possível vincular', 'Falha de rede. Tente novamente.')
    } finally {
      setVinculandoId(null)
    }
  }

  return (
    <div className="space-y-2">
      <div className="relative">
        <Search
          className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden
        />
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Buscar cliente por nome…"
          aria-label="Buscar cliente por nome"
          className="h-9 pl-9 text-sm"
        />
      </div>

      {buscando ? (
        <p className="flex items-center gap-2 px-1 text-xs text-muted-foreground">
          <Spinner className="h-3.5 w-3.5" /> Buscando…
        </p>
      ) : resultados.length > 0 ? (
        <ul className="overflow-hidden rounded-lg border border-border" aria-label="Clientes encontrados">
          {resultados.map((c) => (
            <li key={c.id}>
              <button
                type="button"
                onClick={() => vincular(c)}
                disabled={vinculandoId !== null}
                className={cn(
                  'flex w-full items-center gap-2 border-b border-border px-3 py-2 text-left text-sm transition-colors last:border-b-0',
                  'hover:bg-muted disabled:opacity-60',
                )}
              >
                <UserRound className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                <span className="min-w-0 flex-1 truncate font-medium text-foreground">{c.nome}</span>
                {vinculandoId === c.id ? (
                  <Spinner className="h-4 w-4 shrink-0" />
                ) : (
                  <Link2 className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                )}
              </button>
            </li>
          ))}
        </ul>
      ) : buscou && q.trim().length >= 2 ? (
        <p className="px-1 text-xs text-muted-foreground">Nenhum cliente encontrado.</p>
      ) : (
        <p className="px-1 text-xs text-muted-foreground">Digite ao menos 2 letras para buscar.</p>
      )}
    </div>
  )
}
