'use client'

import { useEffect, useRef, useState } from 'react'
import { Link2, Search, UserRound } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Spinner } from '@/components/ui/spinner'
import { ConfirmDialog } from '@/components/ui/dialog'
import { useToast } from '@/components/ui/toast'
import { cn } from '@/lib/utils'
import { codeDoErro, mensagemErroRelay } from './erros'

interface ClienteBusca {
  id: string
  nome: string
  telefone: string | null
}

/**
 * Busca de clientes do SIMAS (por nome) + vínculo do telefone da conversa.
 * Fluxo: digita -> GET /api/conversas/clientes?q= (debounce) -> clica num
 * resultado -> POST /api/conversas/vincular. Se o cliente já tiver OUTRO
 * telefone, a API devolve 409 TELEFONE_DIFERENTE e pedimos confirmação
 * antes de reenviar com { substituir: true }.
 */
export function VincularCliente({
  telefone,
  onVinculado,
}: {
  telefone: string
  onVinculado: () => void
}) {
  const { success, error: toastError } = useToast()

  const [q, setQ] = useState('')
  const [resultados, setResultados] = useState<ClienteBusca[]>([])
  const [buscando, setBuscando] = useState(false)
  const [erroBusca, setErroBusca] = useState<string | null>(null)
  const [buscou, setBuscou] = useState(false)

  const [vinculandoId, setVinculandoId] = useState<string | null>(null)
  const [confirmacao, setConfirmacao] = useState<{
    cliente: ClienteBusca
    telefoneAtual: string | null
  } | null>(null)
  const [confirmando, setConfirmando] = useState(false)

  // Guarda a última busca disparada para descartar respostas atrasadas.
  const buscaSeq = useRef(0)

  // Busca com debounce (300ms) a partir de 2 caracteres.
  useEffect(() => {
    const termo = q.trim()
    if (termo.length < 2) {
      setResultados([])
      setBuscando(false)
      setErroBusca(null)
      setBuscou(false)
      return
    }
    setBuscando(true)
    setErroBusca(null)
    const seq = ++buscaSeq.current
    const timer = setTimeout(async () => {
      try {
        const r = await fetch(`/api/conversas/clientes?q=${encodeURIComponent(termo)}`)
        const d = await r.json().catch(() => ({}))
        if (seq !== buscaSeq.current) return
        if (!r.ok) {
          setErroBusca(mensagemErroRelay(r.status, d))
          setResultados([])
        } else {
          const lista = (d as { clientes?: ClienteBusca[] }).clientes
          setResultados(Array.isArray(lista) ? lista : [])
        }
        setBuscou(true)
      } catch {
        if (seq !== buscaSeq.current) return
        setErroBusca('Falha de rede ao buscar clientes.')
        setResultados([])
        setBuscou(true)
      } finally {
        if (seq === buscaSeq.current) setBuscando(false)
      }
    }, 300)
    return () => clearTimeout(timer)
  }, [q])

  async function vincular(cliente: ClienteBusca, substituir: boolean) {
    setVinculandoId(cliente.id)
    if (substituir) setConfirmando(true)
    try {
      const body: { clienteId: string; telefone: string; substituir?: boolean } = {
        clienteId: cliente.id,
        telefone,
      }
      if (substituir) body.substituir = true
      const r = await fetch('/api/conversas/vincular', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const d = await r.json().catch(() => ({}))
      if (r.status === 409 && codeDoErro(d) === 'TELEFONE_EM_USO') {
        const nomeConflito = (d as { clienteNome?: unknown }).clienteNome
        setConfirmacao(null)
        toastError(
          'Telefone já vinculado',
          `Este telefone já pertence a ${
            typeof nomeConflito === 'string' && nomeConflito ? nomeConflito : 'outro cliente'
          }. Ajuste o telefone desse cliente no cadastro antes de vincular.`,
        )
        return
      }
      if (r.status === 409 && codeDoErro(d) === 'TELEFONE_DIFERENTE') {
        const atual = (d as { telefoneAtual?: unknown }).telefoneAtual
        setConfirmacao({ cliente, telefoneAtual: typeof atual === 'string' ? atual : null })
        return
      }
      if (!r.ok) {
        toastError('Não foi possível vincular', mensagemErroRelay(r.status, d))
        return
      }
      setConfirmacao(null)
      success('Cliente vinculado', `${cliente.nome} agora está vinculado a este contato.`)
      onVinculado()
    } catch {
      toastError('Não foi possível vincular', 'Falha de rede. Tente novamente.')
    } finally {
      setVinculandoId(null)
      setConfirmando(false)
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
      ) : erroBusca ? (
        <p className="px-1 text-xs text-destructive">{erroBusca}</p>
      ) : resultados.length > 0 ? (
        <ul className="overflow-hidden rounded-lg border border-border" aria-label="Clientes encontrados">
          {resultados.map((c) => (
            <li key={c.id}>
              <button
                type="button"
                onClick={() => vincular(c, false)}
                disabled={vinculandoId !== null}
                className={cn(
                  'flex w-full items-center gap-2 border-b border-border px-3 py-2 text-left text-sm transition-colors last:border-b-0',
                  'hover:bg-muted disabled:opacity-60',
                )}
              >
                <UserRound className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium text-foreground">{c.nome}</span>
                  {c.telefone && (
                    <span className="block truncate text-xs text-muted-foreground">{c.telefone}</span>
                  )}
                </span>
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

      <ConfirmDialog
        open={confirmacao !== null}
        onClose={() => setConfirmacao(null)}
        onConfirm={() => {
          if (confirmacao) void vincular(confirmacao.cliente, true)
        }}
        title="Substituir telefone?"
        description={
          confirmacao ? (
            <span>
              <strong className="text-foreground">{confirmacao.cliente.nome}</strong> já tem o telefone{' '}
              <strong className="text-foreground">{confirmacao.telefoneAtual || '(não informado)'}</strong>{' '}
              cadastrado. Substituir pelo telefone desta conversa (
              <strong className="text-foreground">{telefone}</strong>)?
            </span>
          ) : (
            ''
          )
        }
        confirmLabel="Substituir telefone"
        cancelLabel="Cancelar"
        variant="danger"
        loading={confirmando}
      />
    </div>
  )
}
