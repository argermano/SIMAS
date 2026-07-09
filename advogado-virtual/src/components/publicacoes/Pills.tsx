'use client'

import { cn } from '@/lib/utils'
import {
  PRIORIDADE_META,
  STATUS_META,
  type PrioridadeHint,
  type PublicacaoStatus,
} from './tipos'

/** Pill de STATUS de tratamento — contraste garantido em qualquer fundo. */
const PILL_CLASSES: Record<PublicacaoStatus, string> = {
  nova:          'bg-warning/15 text-warning ring-1 ring-warning/40',
  triada:        'bg-muted text-muted-foreground ring-1 ring-border',
  tarefa_criada: 'bg-success/15 text-success ring-1 ring-success/40',
  descartada:    'bg-muted text-muted-foreground ring-1 ring-border',
}

export function StatusPill({ status, className }: { status: PublicacaoStatus; className?: string }) {
  const label = (STATUS_META[status] ?? STATUS_META.nova).label
  return (
    <span
      className={cn(
        'inline-block whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-semibold',
        PILL_CLASSES[status] ?? PILL_CLASSES.nova,
        className,
      )}
    >
      {label}
    </span>
  )
}

/** Badge de PRIORIDADE = hint de RELEVÂNCIA (não de prazo). Ponto colorido +
 * rótulo neutro (Alta/Média/Baixa). O title deixa explícito que não é prazo. */
export function PrioridadeBadge({
  nivel,
  className,
}: {
  nivel: PrioridadeHint
  className?: string
}) {
  const meta = PRIORIDADE_META[nivel]
  return (
    <span
      title="Relevância estimada pela categoria da publicação — não é prazo."
      className={cn(
        'inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-semibold ring-1',
        meta.texto,
        meta.ring,
        className,
      )}
    >
      <span className={cn('h-1.5 w-1.5 rounded-full', meta.dot)} aria-hidden />
      {meta.label}
    </span>
  )
}
