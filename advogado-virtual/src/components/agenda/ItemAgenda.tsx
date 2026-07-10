'use client'

// Pílula pastel de um item do calendário (redesign /agenda): ícone do tipo +
// título truncado, cores de TIPO_META, riscado quando concluída/cancelada.
// Também exporta helpers de horário em America/Sao_Paulo reaproveitados pelas grades.

import { cn, iniciais } from '@/lib/utils'
import type { EventoCalendario } from '@/lib/agenda/tipos'
import { TIPO_META } from './tipoMeta'

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
  const meta = TIPO_META[evento.fonte]
  const Icone = meta.Icone

  return (
    <button
      type="button"
      onClick={e => {
        e.stopPropagation()
        onClick(evento)
      }}
      title={`${meta.rotulo} · ${evento.titulo}`}
      className={cn(
        'group flex w-full items-center gap-1 overflow-hidden rounded-md px-1.5 py-1 text-left text-xs font-medium transition-opacity hover:opacity-80',
        meta.pill,
        encerrado && 'opacity-70',
        className,
      )}
    >
      <Icone className="h-3 w-3 shrink-0" aria-hidden="true" />
      {mostrarHora && !evento.diaTodo && (
        <span className="shrink-0 tabular-nums">{horaLabelSP(evento.inicio)}</span>
      )}
      <span className={cn('min-w-0 flex-1 truncate', encerrado && 'line-through')}>
        {rotulo && <span className="font-semibold">{rotulo} · </span>}
        {evento.titulo}
      </span>
    </button>
  )
}
