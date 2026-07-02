'use client'

import { useMemo } from 'react'
import { CalendarClock } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { TaskData } from './TaskCard'

interface ProximosPrazosProps {
  tasks: TaskData[]
  onTaskClick?: (task: TaskData) => void
}

const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez']

function rotuloData(iso: string): string {
  const d = new Date(iso)
  const dia = String(d.getDate()).padStart(2, '0')
  return `${dia}/${MESES[d.getMonth()]}`
}

/**
 * Alternativa ao calendário do kanban para telas menores que xl (onde o
 * calendário fica oculto): lista compacta das tarefas com prazo mais próximo,
 * vencidas em destaque. Toca no mesmo dado (task.due_date) do KanbanCalendar.
 */
export function ProximosPrazos({ tasks, onTaskClick }: ProximosPrazosProps) {
  const proximas = useMemo(() => {
    return tasks
      .filter((t) => t.due_date && !t.completed_at)
      .sort((a, b) => new Date(a.due_date!).getTime() - new Date(b.due_date!).getTime())
      .slice(0, 8)
  }, [tasks])

  if (proximas.length === 0) return null

  const agora = Date.now()

  return (
    <div className="rounded-xl border border-border bg-card p-3 xl:hidden">
      <p className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-foreground">
        <CalendarClock className="h-4 w-4 text-muted-foreground" />
        Próximos prazos
      </p>
      <ul className="space-y-1">
        {proximas.map((t) => {
          const vencida = new Date(t.due_date!).getTime() < agora
          return (
            <li key={t.id}>
              <button
                onClick={() => onTaskClick?.(t)}
                className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm hover:bg-muted transition-colors"
              >
                <span
                  className={cn(
                    'w-14 shrink-0 font-mono text-xs',
                    vencida ? 'font-semibold text-destructive' : 'text-muted-foreground',
                  )}
                >
                  {rotuloData(t.due_date!)}
                </span>
                <span className="truncate text-foreground">{t.description}</span>
              </button>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
