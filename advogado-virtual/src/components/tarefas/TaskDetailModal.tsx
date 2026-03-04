'use client'

import { useState, useEffect } from 'react'
import { Textarea } from '@/components/ui/textarea'
import { Select } from '@/components/ui/select'
import { Button } from '@/components/ui/button'
import { useToast } from '@/components/ui/toast'
import { ConfirmDialog } from '@/components/ui/dialog'
import {
  X, Calendar, User, Flag, Layers, Tag,
  CheckCircle2, Trash2, Loader2, Pencil, Check,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import type { TaskData } from './TaskCard'

interface Column   { id: string; name: string; position: number; color?: string | null }
interface Board    { id: string; name: string; kanban_columns: Column[] }
interface TaskList { id: string; name: string }
interface TaskTag  { id: string; name: string; color: string }

interface TeamMember { id: string; nome: string }

interface TaskDetailModalProps {
  task:         TaskData
  boards:       Board[]
  lists:        TaskList[]
  tags:         TaskTag[]
  teamMembers?: TeamMember[]
  open:         boolean
  onClose:      () => void
  onSaved:      () => void
}

const PRIORITY_OPTIONS = [
  { value: 'baixa',   label: 'Baixa' },
  { value: 'media',   label: 'Média' },
  { value: 'alta',    label: 'Alta' },
  { value: 'urgente', label: 'Urgente' },
]

const PRIORITY_COLORS: Record<string, string> = {
  baixa:   'bg-emerald-100 text-emerald-700',
  media:   'bg-blue-100 text-blue-700',
  alta:    'bg-warning/10 text-warning',
  urgente: 'bg-destructive/10 text-destructive',
}

const PRIORITY_LABELS: Record<string, string> = {
  baixa: 'Baixa', media: 'Média', alta: 'Alta', urgente: 'Urgente',
}

function formatDateBR(iso: string) {
  return new Date(iso).toLocaleDateString('pt-BR', {
    day: '2-digit', month: '2-digit', year: 'numeric',
  })
}

function toInputDate(iso: string | null | undefined) {
  if (!iso) return ''
  return iso.slice(0, 10)
}

function initials(nome: string) {
  return nome.split(' ').map(n => n[0]).slice(0, 2).join('').toUpperCase()
}

export function TaskDetailModal({
  task, boards, lists, tags, teamMembers, open, onClose, onSaved,
}: TaskDetailModalProps) {
  const { success, error: toastError } = useToast()

  const [description,  setDescription]  = useState(task.description)
  const [dueDate,      setDueDate]       = useState(toInputDate(task.due_date))
  const [priority,     setPriority]      = useState(task.priority)
  const [assigneeId,   setAssigneeId]    = useState(task.assignee_id ?? task.users?.id ?? '')
  const [boardId,      setBoardId]       = useState(task.kanban_board_id ?? '')
  const [columnId,     setColumnId]      = useState(task.kanban_column_id ?? '')
  const [taskListId,   setTaskListId]    = useState(task.task_list_id ?? '')
  const [selectedTags, setSelectedTags]  = useState<string[]>(
    (task.task_tag_links ?? []).map(l => l.tag_id)
  )
  const [editingDesc,  setEditingDesc]   = useState(false)
  const [saving,       setSaving]        = useState(false)
  const [completing,   setCompleting]    = useState(false)
  const [confirmDel,   setConfirmDel]    = useState(false)
  const [deleting,     setDeleting]      = useState(false)
  const [isCompleted,  setIsCompleted]   = useState(!!task.completed_at)

  // Resetar estado quando a tarefa mudar
  useEffect(() => {
    setDescription(task.description)
    setDueDate(toInputDate(task.due_date))
    setPriority(task.priority)
    setAssigneeId(task.assignee_id ?? task.users?.id ?? '')
    setBoardId(task.kanban_board_id ?? '')
    setColumnId(task.kanban_column_id ?? '')
    setTaskListId(task.task_list_id ?? '')
    setSelectedTags((task.task_tag_links ?? []).map(l => l.tag_id))
    setIsCompleted(!!task.completed_at)
    setEditingDesc(false)
  }, [task.id])

  if (!open) return null

  const currentBoard  = boards.find(b => b.id === boardId)
  const columnOptions = [...(currentBoard?.kanban_columns ?? [])]
    .sort((a, b) => a.position - b.position)
    .map(c => ({ value: c.id, label: c.name }))

  const allAssignees = [
    task.users ? { id: task.users.id, nome: task.users.nome } : null,
    ...(task.task_assignees ?? []).map(a => a.users),
  ].filter(Boolean) as { id: string; nome: string }[]

  function handleBoardChange(id: string) {
    setBoardId(id)
    const b      = boards.find(b => b.id === id)
    const first  = [...(b?.kanban_columns ?? [])].sort((a, b) => a.position - b.position)[0]
    setColumnId(first?.id ?? '')
  }

  function toggleTag(id: string) {
    setSelectedTags(prev => prev.includes(id) ? prev.filter(t => t !== id) : [...prev, id])
  }

  async function save(extra?: Record<string, unknown>) {
    setSaving(true)
    try {
      const res = await fetch(`/api/tasks/${task.id}`, {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          description,
          due_date:         dueDate || null,
          priority,
          assignee_id:      assigneeId || null,
          kanban_board_id:  boardId  || null,
          kanban_column_id: columnId || null,
          task_list_id:     taskListId || null,
          tag_ids:          selectedTags,
          ...extra,
        }),
      })
      if (!res.ok) {
        const d = await res.json()
        toastError('Erro', d.error ?? 'Não foi possível salvar')
        return false
      }
      success('Salvo!', '')
      onSaved()
      return true
    } finally {
      setSaving(false)
    }
  }

  async function handleComplete() {
    setCompleting(true)
    try {
      const now = isCompleted ? null : new Date().toISOString()
      const res = await fetch(`/api/tasks/${task.id}`, {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ completed_at: now }),
      })
      if (res.ok) {
        setIsCompleted(!isCompleted)
        success(isCompleted ? 'Reaberta!' : 'Concluída!', '')
        onSaved()
      }
    } finally {
      setCompleting(false)
    }
  }

  async function handleDelete() {
    setDeleting(true)
    try {
      const res = await fetch(`/api/tasks/${task.id}`, { method: 'DELETE' })
      if (res.ok) {
        success('Excluída!', '')
        onSaved()
        onClose()
      }
    } finally {
      setDeleting(false)
      setConfirmDel(false)
    }
  }

  return (
    <>
      {/* Overlay */}
      <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-4 pt-12">
        <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />

        <div className="relative w-full max-w-2xl rounded-2xl bg-card shadow-2xl">
          {/* ── Barra colorida de prioridade ── */}
          <div
            className="h-1.5 w-full rounded-t-2xl"
            style={{
              backgroundColor:
                task.priority === 'urgente' ? '#ef4444' :
                task.priority === 'alta'    ? '#f59e0b' :
                task.priority === 'media'   ? '#3b82f6' : '#10b981',
            }}
          />

          {/* ── Header ── */}
          <div className="flex items-start justify-between px-6 pt-5 pb-2">
            <div className="flex items-center gap-2 flex-wrap">
              <span className={cn(
                'rounded-full px-2.5 py-0.5 text-xs font-semibold',
                PRIORITY_COLORS[task.priority]
              )}>
                {PRIORITY_LABELS[task.priority]}
              </span>
              {isCompleted && (
                <span className="rounded-full bg-success/10 px-2.5 py-0.5 text-xs font-semibold text-success">
                  Concluída
                </span>
              )}
              {(task.task_tag_links ?? []).map(l => l.task_tags && (
                <span
                  key={l.tag_id}
                  className="rounded-full px-2.5 py-0.5 text-xs font-semibold text-white"
                  style={{ backgroundColor: l.task_tags.color }}
                >
                  {l.task_tags.name}
                </span>
              ))}
            </div>
            <button
              onClick={onClose}
              className="rounded-md p-1 text-muted-foreground hover:text-foreground transition-colors"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          {/* ── Descrição editável ── */}
          <div className="px-6 pb-4">
            {editingDesc ? (
              <div className="space-y-2">
                <Textarea
                  autoFocus
                  rows={4}
                  value={description}
                  onChange={e => setDescription(e.target.value)}
                  className="text-base font-medium"
                />
                <div className="flex gap-2">
                  <Button size="sm" onClick={() => { save(); setEditingDesc(false) }} loading={saving}>
                    <Check className="h-4 w-4" /> Salvar
                  </Button>
                  <Button size="sm" variant="secondary" onClick={() => {
                    setDescription(task.description)
                    setEditingDesc(false)
                  }}>
                    Cancelar
                  </Button>
                </div>
              </div>
            ) : (
              <button
                onClick={() => setEditingDesc(true)}
                className="group flex w-full items-start gap-2 text-left"
              >
                <p className={cn(
                  'flex-1 text-base font-medium text-foreground leading-relaxed',
                  isCompleted && 'line-through text-muted-foreground'
                )}>
                  {description}
                </p>
                <Pencil className="mt-0.5 h-4 w-4 shrink-0 text-border opacity-0 group-hover:opacity-100 transition-opacity" />
              </button>
            )}
          </div>

          {/* ── Campos ── */}
          <div className="grid grid-cols-2 gap-4 px-6 pb-4">
            {/* Vencimento */}
            <div className="space-y-1">
              <label className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                <Calendar className="h-3.5 w-3.5" /> Vencimento
              </label>
              <input
                type="date"
                value={dueDate}
                onChange={e => setDueDate(e.target.value)}
                className="h-9 w-full rounded-md border border-border px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </div>

            {/* Prioridade */}
            <div className="space-y-1">
              <label className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                <Flag className="h-3.5 w-3.5" /> Prioridade
              </label>
              <Select
                value={priority}
                onChange={e => setPriority(e.target.value as typeof priority)}
                options={PRIORITY_OPTIONS}
              />
            </div>

            {/* Quadro */}
            <div className="space-y-1">
              <label className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                <Layers className="h-3.5 w-3.5" /> Quadro
              </label>
              <Select
                value={boardId}
                onChange={e => handleBoardChange(e.target.value)}
                options={boards.map(b => ({ value: b.id, label: b.name }))}
                placeholder="Selecione..."
              />
            </div>

            {/* Coluna */}
            <div className="space-y-1">
              <label className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Coluna
              </label>
              <Select
                value={columnId}
                onChange={e => setColumnId(e.target.value)}
                options={columnOptions}
                placeholder="Selecione..."
                disabled={!boardId}
              />
            </div>

            {/* Lista */}
            <div className="space-y-1">
              <label className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Lista
              </label>
              <Select
                value={taskListId}
                onChange={e => setTaskListId(e.target.value)}
                options={lists.map(l => ({ value: l.id, label: l.name }))}
                placeholder="Nenhuma"
              />
            </div>

            {/* Responsável */}
            <div className="space-y-1">
              <label className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                <User className="h-3.5 w-3.5" /> Responsável
              </label>
              {teamMembers && teamMembers.length > 0 ? (
                <Select
                  value={assigneeId}
                  onChange={e => setAssigneeId(e.target.value)}
                  options={teamMembers.map(m => ({ value: m.id, label: m.nome }))}
                  placeholder="Selecione..."
                />
              ) : (
                <div className="flex flex-wrap gap-1.5 pt-1">
                  {allAssignees.map(u => (
                    <span
                      key={u.id}
                      title={u.nome}
                      className="flex items-center gap-1.5 rounded-full bg-primary/5 px-2.5 py-1 text-xs font-medium text-primary"
                    >
                      <span className="flex h-5 w-5 items-center justify-center rounded-full bg-primary/80 text-[9px] font-bold text-white">
                        {initials(u.nome)}
                      </span>
                      {u.nome.split(' ')[0]}
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* ── Tags ── */}
          {tags.length > 0 && (
            <div className="px-6 pb-4">
              <label className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                <Tag className="h-3.5 w-3.5" /> Etiquetas
              </label>
              <div className="flex flex-wrap gap-2">
                {tags.map(tag => (
                  <button
                    key={tag.id}
                    type="button"
                    onClick={() => toggleTag(tag.id)}
                    className="rounded-full px-3 py-1 text-xs font-semibold text-white transition-opacity"
                    style={{
                      backgroundColor: tag.color,
                      opacity: selectedTags.includes(tag.id) ? 1 : 0.3,
                    }}
                  >
                    {tag.name}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* ── Datas de criação / conclusão ── */}
          <div className="flex gap-6 border-t border-border px-6 py-3 text-xs text-muted-foreground">
            {task.created_at && (
              <span>Criada em {formatDateBR(task.created_at as string)}</span>
            )}
            {task.completed_at && (
              <span>Concluída em {formatDateBR(task.completed_at)}</span>
            )}
          </div>

          {/* ── Footer ── */}
          <div className="flex items-center justify-between border-t border-border px-6 py-4">
            <div className="flex gap-2">
              {/* Concluir / Reabrir */}
              <Button
                size="sm"
                variant={isCompleted ? 'secondary' : 'default'}
                onClick={handleComplete}
                disabled={completing}
                className={isCompleted ? '' : 'bg-success hover:bg-success/90 text-white border-0'}
              >
                {completing
                  ? <Loader2 className="h-4 w-4 animate-spin" />
                  : <CheckCircle2 className="h-4 w-4" />
                }
                {isCompleted ? 'Reabrir' : 'Concluir'}
              </Button>

              {/* Salvar alterações */}
              <Button size="sm" variant="secondary" onClick={() => save()} loading={saving}>
                Salvar alterações
              </Button>
            </div>

            {/* Excluir */}
            <button
              onClick={() => setConfirmDel(true)}
              className="flex items-center gap-1.5 rounded-md px-3 py-2 text-sm text-destructive hover:bg-destructive/5 hover:text-destructive transition-colors"
            >
              <Trash2 className="h-4 w-4" />
              Excluir
            </button>
          </div>
        </div>
      </div>

      <ConfirmDialog
        open={confirmDel}
        onClose={() => setConfirmDel(false)}
        onConfirm={handleDelete}
        title="Excluir tarefa"
        description="Tem certeza que deseja excluir esta tarefa? Esta ação não pode ser desfeita."
        confirmLabel="Excluir"
        variant="danger"
        loading={deleting}
      />
    </>
  )
}
