import type { LucideIcon } from 'lucide-react'
import { Users, Video, ClipboardCheck, Gavel, Bell } from 'lucide-react'
import type { FonteAgenda } from '@/lib/agenda/tipos'

/**
 * Metadados visuais por fonte da agenda (redesign /agenda).
 * A fonte 'evento' é ROTULADA "Reunião" no UI; o valor interno/DB continua 'evento'.
 */
export const TIPO_META: Record<
  FonteAgenda,
  { rotulo: string; dot: string; pill: string; texto: string; Icone: LucideIcon }
> = {
  evento: {
    rotulo: 'Reunião',
    dot: 'bg-blue-500',
    pill: 'bg-blue-100 text-blue-800 dark:bg-blue-950/50 dark:text-blue-200',
    texto: 'text-blue-800 dark:text-blue-200',
    Icone: Users,
  },
  consulta: {
    rotulo: 'Consulta',
    dot: 'bg-violet-500',
    pill: 'bg-violet-100 text-violet-800 dark:bg-violet-950/50 dark:text-violet-200',
    texto: 'text-violet-800 dark:text-violet-200',
    Icone: Video,
  },
  prazo: {
    rotulo: 'Prazo',
    dot: 'bg-rose-500',
    pill: 'bg-rose-100 text-rose-800 dark:bg-rose-950/50 dark:text-rose-200',
    texto: 'text-rose-800 dark:text-rose-200',
    Icone: ClipboardCheck,
  },
  audiencia: {
    rotulo: 'Audiência',
    dot: 'bg-emerald-500',
    pill: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-200',
    texto: 'text-emerald-800 dark:text-emerald-200',
    Icone: Gavel,
  },
  tarefa: {
    rotulo: 'Tarefa',
    dot: 'bg-amber-500',
    pill: 'bg-amber-100 text-amber-800 dark:bg-amber-950/50 dark:text-amber-200',
    texto: 'text-amber-800 dark:text-amber-200',
    Icone: Bell,
  },
}

/** Ordem dos chips de tipo na toolbar. */
export const ORDEM_CHIPS: FonteAgenda[] = ['evento', 'consulta', 'prazo', 'audiencia', 'tarefa']
