'use client'

import { useState, useEffect, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { useToast } from '@/components/ui/toast'
import { Plus, ListChecks, Calendar, User } from 'lucide-react'
import { cn } from '@/lib/utils'
import { TaskFormModal } from './TaskFormModal'

interface TeamMember { id: string; nome: string }

interface Subtarefa {
  id:               string
  description:      string
  due_date:         string | null
  priority:         string
  completed_at:     string | null
  kanban_column_id: string | null
  coluna:           { id: string; name: string } | null
  assignee:         { id: string; nome: string | null } | null
}

interface Props {
  taskId:           string
  teamMembers?:     TeamMember[]
  currentUserId?:   string
  currentUserName?: string
  defaultBoardId?:  string
  /** Reporta a quantidade ao pai (alimenta o badge da aba). */
  onCountChange?:   (n: number) => void
}

const PRIORITY_COLORS: Record<string, string> = {
  baixa: '#10b981', media: '#3b82f6', alta: '#f59e0b', urgente: '#ef4444',
}

function formatDateBR(iso: string) {
  return new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })
}

/**
 * Seção "Subtarefas" do modal de tarefa. Lista as tarefas-filha
 * (GET /api/tasks/[id]/subtarefas), permite concluir/reabrir cada uma
 * (PATCH completed_at) e adicionar novas reusando o TaskFormModal com
 * parentTaskId pré-setado. Concluída = completed_at preenchido.
 */
export function SubtarefasSecao({
  taskId, teamMembers, currentUserId, currentUserName, defaultBoardId, onCountChange,
}: Props) {
  const { error: toastError } = useToast()
  const [subs,     setSubs]     = useState<Subtarefa[]>([])
  const [loading,  setLoading]  = useState(true)
  const [formOpen, setFormOpen] = useState(false)

  const carregar = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/tasks/${taskId}/subtarefas`)
      const d   = await res.json().catch(() => ({}))
      const lista = (d.subtarefas ?? []) as Subtarefa[]
      setSubs(lista)
      onCountChange?.(lista.length)
    } catch {
      setSubs([])
    } finally {
      setLoading(false)
    }
  }, [taskId, onCountChange])

  useEffect(() => { carregar() }, [carregar])

  async function alternar(sub: Subtarefa) {
    const novo = sub.completed_at ? null : new Date().toISOString()
    // Otimista: reflete o check imediatamente; reverte via reload se o PATCH falhar.
    setSubs(prev => prev.map(s => (s.id === sub.id ? { ...s, completed_at: novo } : s)))
    const res = await fetch(`/api/tasks/${sub.id}`, {
      method:  'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ completed_at: novo }),
    })
    if (!res.ok) {
      toastError('Erro', 'Não foi possível atualizar a subtarefa')
      carregar()
    }
  }

  return (
    <div className="space-y-3">
      {loading ? (
        <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
          <Spinner size="sm" /> Carregando subtarefas…
        </div>
      ) : subs.length === 0 ? (
        <div className="flex flex-col items-center gap-1.5 py-6 text-center text-sm text-muted-foreground">
          <ListChecks className="h-5 w-5 opacity-60" />
          Nenhuma subtarefa ainda.
        </div>
      ) : (
        <ul className="space-y-1.5">
          {subs.map(sub => {
            const concluida = !!sub.completed_at
            const nome = sub.assignee?.nome?.split(' ')[0] ?? null
            return (
              <li
                key={sub.id}
                className="flex items-start gap-2.5 rounded-lg border border-border px-3 py-2"
              >
                <input
                  type="checkbox"
                  checked={concluida}
                  onChange={() => alternar(sub)}
                  aria-label={concluida ? `Reabrir "${sub.description}"` : `Concluir "${sub.description}"`}
                  className="mt-0.5 h-4 w-4 shrink-0 cursor-pointer accent-primary"
                />
                <div className="min-w-0 flex-1">
                  <p className={cn(
                    'text-sm font-medium text-foreground',
                    concluida && 'line-through text-muted-foreground',
                  )}>
                    {sub.description}
                  </p>
                  <div className="mt-0.5 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                    <span
                      className="inline-flex items-center gap-1"
                      style={{ color: PRIORITY_COLORS[sub.priority] }}
                    >
                      <span className="h-2 w-2 rounded-full" style={{ backgroundColor: PRIORITY_COLORS[sub.priority] ?? '#6b7280' }} />
                    </span>
                    {nome && (
                      <span className="inline-flex items-center gap-1">
                        <User className="h-3 w-3" /> {nome}
                      </span>
                    )}
                    {sub.due_date && (
                      <span className={cn(
                        'inline-flex items-center gap-1',
                        new Date(sub.due_date) < new Date() && !concluida && 'text-destructive font-medium',
                      )}>
                        <Calendar className="h-3 w-3" /> {formatDateBR(sub.due_date)}
                      </span>
                    )}
                  </div>
                </div>
              </li>
            )
          })}
        </ul>
      )}

      <Button size="sm" variant="secondary" onClick={() => setFormOpen(true)}>
        <Plus className="h-4 w-4" /> Adicionar subtarefa
      </Button>

      {formOpen && (
        <TaskFormModal
          open={formOpen}
          onClose={() => setFormOpen(false)}
          // Recarrega a lista sem fechar o modal-mãe (não usa o onSaved do detalhe).
          onSaved={() => { setFormOpen(false); carregar() }}
          currentUserId={currentUserId ?? teamMembers?.[0]?.id ?? ''}
          currentUserName={currentUserName ?? teamMembers?.[0]?.nome ?? ''}
          teamMembers={teamMembers}
          defaultBoardId={defaultBoardId}
          parentTaskId={taskId}
        />
      )}
    </div>
  )
}
