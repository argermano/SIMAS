'use client'

import { useEffect, useState } from 'react'
import { AlertTriangle, Clock, X } from 'lucide-react'

interface Task {
  id: string
  description: string
  due_date: string
  priority: string
}

export function TaskDueNotification() {
  const [todayTasks, setTodayTasks] = useState<Task[]>([])
  const [overdueTasks, setOverdueTasks] = useState<Task[]>([])
  const [dismissed, setDismissed] = useState(false)

  useEffect(() => {
    // Só mostrar uma vez por sessão
    const shown = sessionStorage.getItem('task-due-notification-shown')
    if (shown) return

    fetch('/api/tasks/due-today')
      .then(r => r.json())
      .then(data => {
        setTodayTasks(data.today ?? [])
        setOverdueTasks(data.overdue ?? [])
        sessionStorage.setItem('task-due-notification-shown', '1')
      })
      .catch(() => {})
  }, [])

  const total = todayTasks.length + overdueTasks.length
  if (dismissed || total === 0) return null

  return (
    <div className="border-b border-border bg-warning/5 px-6 py-3 shrink-0">
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-3 min-w-0">
          <div className="mt-0.5 shrink-0 rounded-full bg-warning/10 p-1.5">
            {overdueTasks.length > 0
              ? <AlertTriangle className="h-4 w-4 text-destructive" />
              : <Clock className="h-4 w-4 text-warning" />
            }
          </div>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-foreground">
              {overdueTasks.length > 0 && todayTasks.length > 0
                ? `${overdueTasks.length} tarefa(s) atrasada(s) e ${todayTasks.length} para hoje`
                : overdueTasks.length > 0
                  ? `${overdueTasks.length} tarefa(s) atrasada(s)`
                  : `${todayTasks.length} tarefa(s) vencem hoje`
              }
            </p>
            <ul className="mt-1 space-y-0.5">
              {overdueTasks.slice(0, 3).map(t => (
                <li key={t.id} className="flex items-center gap-2 text-xs text-destructive">
                  <span className="h-1.5 w-1.5 rounded-full bg-destructive shrink-0" />
                  <span className="truncate">{t.description}</span>
                  <span className="shrink-0 text-destructive/70">
                    (atrasada - {new Date(t.due_date).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })})
                  </span>
                </li>
              ))}
              {todayTasks.slice(0, 3).map(t => (
                <li key={t.id} className="flex items-center gap-2 text-xs text-muted-foreground">
                  <span className="h-1.5 w-1.5 rounded-full bg-warning shrink-0" />
                  <span className="truncate">{t.description}</span>
                </li>
              ))}
              {total > 6 && (
                <li className="text-xs text-muted-foreground">
                  e mais {total - 6} tarefa(s)...
                </li>
              )}
            </ul>
          </div>
        </div>
        <button
          onClick={() => setDismissed(true)}
          className="shrink-0 rounded-md p-1 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          aria-label="Dispensar notificação"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  )
}
