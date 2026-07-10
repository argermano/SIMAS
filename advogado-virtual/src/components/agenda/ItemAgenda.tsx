'use client'

// Chip/barra de um item do calendário. Consome EventoCalendario de @/lib/agenda/tipos.
// Também exporta helpers de horário em America/Sao_Paulo reaproveitados pelas grades.

import { cn, iniciais } from '@/lib/utils'
import type { EventoCalendario } from '@/lib/agenda/tipos'

const _fmtHora = new Intl.DateTimeFormat('pt-BR', {
  timeZone: 'America/Sao_Paulo',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
})

/** Hora civil (0..23) de um instante ISO na TZ de SP. */
export function horaSP(iso: string): number {
  for (const p of _fmtHora.formatToParts(new Date(iso))) {
    if (p.type === 'hour') return Number(p.value) % 24
  }
  return 0
}

/** Rótulo 'HH:mm' de um instante ISO na TZ de SP. */
export function horaLabelSP(iso: string): string {
  return _fmtHora.format(new Date(iso))
}

/** Rótulo de responsável: 'Eu' quando é o próprio usuário, senão iniciais. */
export function rotuloResponsavel(ev: EventoCalendario, meUserId: string): string {
  if (!ev.responsavel) return ''
  if (ev.responsavel.id === meUserId) return 'Eu'
  return iniciais(ev.responsavel.nome)
}

interface ItemAgendaProps {
  evento: EventoCalendario
  meUserId: string
  onClick: (evento: EventoCalendario) => void
  /** Prefixa o horário de início (grade dia/semana). */
  mostrarHora?: boolean
  className?: string
}

export function ItemAgenda({ evento, meUserId, onClick, mostrarHora, className }: ItemAgendaProps) {
  const encerrado = evento.status === 'concluida' || evento.status === 'cancelada'
  const rotulo = rotuloResponsavel(evento, meUserId)
  const cor = evento.cor || '#6b7280'

  return (
    <button
      type="button"
      onClick={() => onClick(evento)}
      title={evento.titulo}
      className={cn(
        'group flex w-full items-center gap-1 overflow-hidden rounded-md border-l-[3px] px-1.5 py-1 text-left text-xs transition-colors hover:brightness-95',
        className,
      )}
      style={{ borderLeftColor: cor, backgroundColor: `${cor}1f` }}
    >
      {mostrarHora && !evento.diaTodo && (
        <span className="shrink-0 font-medium tabular-nums text-muted-foreground">
          {horaLabelSP(evento.inicio)}
        </span>
      )}
      <span
        className={cn(
          'min-w-0 flex-1 truncate text-foreground',
          encerrado && 'text-muted-foreground line-through',
        )}
      >
        {rotulo && <span className="font-semibold">{rotulo} - </span>}
        {evento.titulo}
      </span>
    </button>
  )
}
