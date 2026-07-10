'use client'

import { MessageSquare } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Spinner } from '@/components/ui/spinner'
import { cn } from '@/lib/utils'
import { horaCurta } from '@/lib/conversas/formato'
import { rotuloAguardando } from '@/lib/conversas/aguardando'
import type { Conversa } from '@/lib/conversas/tipos'
import { AvatarContato } from './AvatarContato'

export type FiltroChip = 'todos' | 'aguardando' | 'nao_atribuidas' | 'resolvidas'

export function ListaConversas({
  conversas,
  loading,
  erro,
  selecionadaId,
  onSelecionar,
  filtroChip = 'todos',
  agoraEpochSeg,
}: {
  conversas: Conversa[]
  loading: boolean
  erro: string | null
  selecionadaId: number | null
  onSelecionar: (id: number) => void
  /** Filtro dos chips do shell; default 'todos' até o shell passar o valor. */
  filtroChip?: FiltroChip
  /** "Agora" (epoch s) vindo do tick do shell — os selos envelhecem sem refetch. */
  agoraEpochSeg?: number
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

  // "resolvidas" e "todos" são passthrough: o status da query já filtra no servidor.
  const visiveis = conversas.filter((c) => {
    if (filtroChip === 'aguardando') return c.aguardandoDesde !== null
    if (filtroChip === 'nao_atribuidas') return c.assignee === null
    return true
  })

  if (visiveis.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border bg-card px-6 py-14 text-center">
        <MessageSquare className="h-8 w-8 text-muted-foreground" aria-hidden />
        <p className="mt-3 text-sm font-medium text-foreground">Nenhuma conversa</p>
        <p className="mt-1 max-w-sm text-sm text-muted-foreground">
          Nenhuma conversa neste filtro. Ajuste os filtros ou a busca acima.
        </p>
      </div>
    )
  }

  const agora = agoraEpochSeg ?? Math.floor(Date.now() / 1000)

  return (
    <ul className="space-y-1">
      {visiveis.map((c) => (
        <li key={c.id}>
          <ItemConversa
            conversa={c}
            selecionado={selecionadaId === c.id}
            agoraEpochSeg={agora}
            onClick={() => onSelecionar(c.id)}
          />
        </li>
      ))}
    </ul>
  )
}

const CLASSE_NIVEL: Record<'ok' | 'atencao' | 'critico', string> = {
  ok: 'text-muted-foreground',
  atencao: 'text-warning',
  critico: 'text-destructive',
}

function ItemConversa({
  conversa,
  selecionado,
  agoraEpochSeg,
  onClick,
}: {
  conversa: Conversa
  selecionado: boolean
  agoraEpochSeg: number
  onClick: () => void
}) {
  const nome = conversa.contato.nome || conversa.contato.telefone || `Conversa #${conversa.id}`
  const trecho = conversa.ultimaMensagem?.trecho ?? ''
  const hora = horaCurta(conversa.ultimaMensagem?.timestamp)
  const naoLidas = conversa.naoLidas

  const resolvida = conversa.status === 'resolved'
  const selo = resolvida ? null : rotuloAguardando(conversa.aguardandoDesde, agoraEpochSeg)
  const critico = selo?.nivel === 'critico'

  // Barra de acento à esquerda: vermelha quando aguardando >= 4h (mesmo sem
  // seleção); primária quando selecionado; transparente no resto.
  const barra = critico
    ? 'border-l-destructive'
    : selecionado
      ? 'border-l-primary'
      : 'border-l-transparent'

  return (
    <article
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onClick()
        }
      }}
      aria-current={selecionado || undefined}
      className={cn(
        'cursor-pointer rounded-lg border-l-2 px-3 py-2.5 transition-colors',
        barra,
        selecionado ? 'bg-primary/[0.06] dark:bg-primary/10' : 'hover:bg-muted/60',
      )}
    >
      {/* Selo superior: tempo aguardando (derivado) ou RESOLVIDO */}
      {(selo || resolvida) && (
        <p
          className={cn(
            'mb-1 text-[10px] font-semibold uppercase tracking-wide',
            resolvida ? 'text-success' : CLASSE_NIVEL[selo!.nivel],
          )}
        >
          {resolvida ? 'RESOLVIDO' : selo!.texto}
        </p>
      )}

      <div className="flex items-start gap-3">
        {/* Avatar: foto do contato (WhatsApp/Chatwoot) com fallback pras iniciais */}
        <AvatarContato nome={nome} avatarUrl={conversa.contato.avatarUrl} className="h-10 w-10" />

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="min-w-0 flex-1 truncate text-sm font-semibold text-foreground">{nome}</h3>
            {hora && <span className="shrink-0 text-[11px] text-muted-foreground">{hora}</span>}
          </div>

          <p className="mt-0.5 truncate text-xs text-muted-foreground">{trecho || 'Sem mensagens'}</p>

          <div className="mt-1 flex items-center gap-1.5">
            <MessageSquare className="h-3 w-3 shrink-0 text-muted-foreground" aria-hidden />
            <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
              WhatsApp
            </span>
            <Badge variant={conversa.inbox === 'DF' ? 'default' : 'accent'} className="px-1.5 py-0 text-[10px]">
              {conversa.inbox}
            </Badge>
            <span className="flex-1" />
            {naoLidas > 0 && (
              <span className="inline-flex h-5 min-w-[1.25rem] shrink-0 items-center justify-center rounded-full bg-foreground px-1.5 text-[11px] font-bold text-background">
                {naoLidas}
              </span>
            )}
          </div>
        </div>
      </div>
    </article>
  )
}
