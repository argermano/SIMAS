'use client'

import { MessageSquare } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Spinner } from '@/components/ui/spinner'
import { cn, iniciais } from '@/lib/utils'
import { horaCurta } from '@/lib/conversas/formato'
import type { Conversa } from '@/lib/conversas/tipos'

export function ListaConversas({
  conversas,
  loading,
  erro,
  selecionadaId,
  onSelecionar,
}: {
  conversas: Conversa[]
  loading: boolean
  erro: string | null
  selecionadaId: number | null
  onSelecionar: (id: number) => void
}) {
  if (loading && conversas.length === 0) {
    return (
      <div className="flex items-center gap-2 py-10 text-sm text-muted-foreground">
        <Spinner className="h-4 w-4" /> Carregando conversas…
      </div>
    )
  }

  if (erro) {
    return (
      <div className="rounded-xl border border-dashed border-destructive/40 bg-destructive/5 px-6 py-10 text-center text-sm text-destructive">
        {erro}
      </div>
    )
  }

  if (conversas.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border bg-card px-6 py-14 text-center">
        <MessageSquare className="h-8 w-8 text-muted-foreground" aria-hidden />
        <p className="mt-3 text-sm font-medium text-foreground">Nenhuma conversa</p>
        <p className="mt-1 max-w-sm text-sm text-muted-foreground">
          Nenhuma conversa neste filtro. Ajuste o status ou o inbox acima.
        </p>
      </div>
    )
  }

  return (
    <ul className="space-y-2">
      {conversas.map((c) => (
        <li key={c.id}>
          <ItemConversa
            conversa={c}
            selecionado={selecionadaId === c.id}
            onClick={() => onSelecionar(c.id)}
          />
        </li>
      ))}
    </ul>
  )
}

function ItemConversa({
  conversa,
  selecionado,
  onClick,
}: {
  conversa: Conversa
  selecionado: boolean
  onClick: () => void
}) {
  const nome = conversa.contato.nome || conversa.contato.telefone || `Conversa #${conversa.id}`
  const trecho = conversa.ultimaMensagem?.trecho ?? ''
  const hora = horaCurta(conversa.ultimaMensagem?.timestamp)
  const naoLidas = conversa.naoLidas

  return (
    <article
      onClick={onClick}
      aria-current={selecionado}
      className={cn(
        'flex cursor-pointer items-start gap-3 rounded-xl border bg-card p-3 shadow-card transition-colors',
        selecionado ? 'border-primary bg-primary/[0.04] ring-1 ring-primary/40' : 'border-border hover:border-ring',
      )}
    >
      {/* Avatar por iniciais */}
      <span
        aria-hidden
        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-bold text-primary"
      >
        {iniciais(nome)}
      </span>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <h3 className="min-w-0 flex-1 truncate font-semibold text-foreground">{nome}</h3>
          {hora && <span className="shrink-0 text-[11px] text-muted-foreground">{hora}</span>}
        </div>

        <div className="mt-0.5 flex items-center gap-2">
          <Badge variant={conversa.inbox === 'DF' ? 'default' : 'accent'} className="px-2 py-0 text-[11px]">
            {conversa.inbox}
          </Badge>
          {conversa.contato.telefone && conversa.contato.nome && (
            <span className="truncate text-[11px] text-muted-foreground">{conversa.contato.telefone}</span>
          )}
        </div>

        <div className="mt-1 flex items-center gap-2">
          <p className="min-w-0 flex-1 truncate text-xs text-muted-foreground">{trecho || 'Sem mensagens'}</p>
          {naoLidas > 0 && (
            <span className="inline-flex h-5 min-w-[1.25rem] shrink-0 items-center justify-center rounded-full bg-primary px-1.5 text-[11px] font-bold text-primary-foreground">
              {naoLidas}
            </span>
          )}
        </div>
      </div>
    </article>
  )
}
