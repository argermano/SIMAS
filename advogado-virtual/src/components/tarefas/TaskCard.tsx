'use client'

import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { cn } from '@/lib/utils'

export interface TaskData {
  id:                string
  description:       string
  due_date?:         string | null
  priority:          'baixa' | 'media' | 'alta' | 'urgente'
  completed_at?:     string | null
  created_at?:       string | null
  assignee_id?:      string | null
  kanban_column_id?: string | null
  task_list_id?:     string | null
  kanban_board_id?:  string | null
  users?:            { id: string; nome: string } | null
  task_tag_links?:   { tag_id: string; task_tags: { id: string; name: string; color: string } | null }[]
  task_assignees?:   { user_id: string; users: { id: string; nome: string } | null }[]
  atendimentos?:     { id: string; area: string } | null
}

const PRIORITY_COLORS: Record<string, string> = {
  baixa:   '#10b981',
  media:   '#3b82f6',
  alta:    '#f59e0b',
  urgente: '#ef4444',
}

function formatDate(iso: string) {
  const d = new Date(iso)
  return d.toLocaleDateString('pt-BR', { day: 'numeric', month: 'long' })
}

function initials(nome: string) {
  return nome.split(' ').map(n => n[0]).slice(0, 2).join('').toUpperCase()
}

interface TaskCardProps {
  task:     TaskData
  onClick?: () => void
}

export function TaskCard({ task, onClick }: TaskCardProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: task.id })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  }

  const tags       = (task.task_tag_links ?? []).map(l => l.task_tags).filter(Boolean)
  const firstTag   = tags[0]
  const borderColor = firstTag?.color ?? PRIORITY_COLORS[task.priority] ?? '#6b7280'

  // Responsáveis: principal + adicionais
  const allAssignees = [
    task.users ? { id: task.users.id, nome: task.users.nome } : null,
    ...(task.task_assignees ?? []).map(a => a.users),
  ].filter(Boolean) as { id: string; nome: string }[]

  const visibleAssignees = allAssignees.slice(0, 2)
  const extra            = allAssignees.length - 2

  return (
    <div
      ref={setNodeRef}
      style={{ ...style, borderLeftColor: borderColor }}
      {...attributes}
      {...listeners}
      onClick={onClick}
      className={cn(
        'cursor-pointer rounded-lg bg-card shadow-sm ring-1 ring-border',
        'border-l-4 p-3 transition-shadow hover:shadow-md',
        task.completed_at && 'opacity-60'
      )}
    >
      {/* Tags */}
      {tags.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-1">
          {tags.map(tag => tag && (
            <span
              key={tag.id}
              className="rounded-full px-2 py-0.5 text-xs font-semibold text-white"
              style={{ backgroundColor: tag.color }}
            >
              {tag.name}
            </span>
          ))}
        </div>
      )}

      {/* Descrição */}
      <p className="line-clamp-2 text-sm font-medium text-foreground">
        {task.description}
      </p>

      {/* Processo vinculado */}
      {task.atendimentos && (
        <p className="mt-1 line-clamp-1 text-xs text-muted-foreground">
          {task.atendimentos.area}
        </p>
      )}

      {/* Footer: avatares + data */}
      <div className="mt-3 flex items-center justify-between">
        <div className="flex items-center gap-1">
          {visibleAssignees.map(u => (
            <span
              key={u.id}
              title={u.nome}
              className="flex h-6 w-6 items-center justify-center rounded-full bg-primary/80 text-[10px] font-bold text-white"
            >
              {initials(u.nome)}
            </span>
          ))}
          {extra > 0 && (
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-muted text-[10px] font-bold text-muted-foreground">
              +{extra}
            </span>
          )}
        </div>

        {task.due_date && (
          <span className={cn(
            'text-xs text-muted-foreground',
            new Date(task.due_date) < new Date() && !task.completed_at && 'text-destructive font-medium'
          )}>
            {formatDate(task.due_date)}
          </span>
        )}
      </div>
    </div>
  )
}
