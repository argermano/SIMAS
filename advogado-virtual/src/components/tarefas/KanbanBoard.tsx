'use client'

import { useState, useCallback, useEffect, useMemo } from 'react'
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  type DragStartEvent,
  type DragEndEvent,
} from '@dnd-kit/core'
import { sortableKeyboardCoordinates } from '@dnd-kit/sortable'
import { useToast } from '@/components/ui/toast'
import { KanbanColumn } from './KanbanColumn'
import { KanbanCalendar } from './KanbanCalendar'
import { ProximosPrazos } from './ProximosPrazos'
import { TaskCard, type TaskData } from './TaskCard'
import { TaskFormModal } from './TaskFormModal'
import { TaskDetailModal } from './TaskDetailModal'

interface Column {
  id:       string
  name:     string
  position: number
  color?:   string | null
}

interface Board {
  id:             string
  name:           string
  kanban_columns: Column[]
}

interface TaskList { id: string; name: string }
interface TaskTag  { id: string; name: string; color: string }

interface TeamMember { id: string; nome: string }

interface KanbanBoardProps {
  board:           Board
  initialTasks:    TaskData[]
  currentUserId:   string
  currentUserName: string
  teamMembers:     TeamMember[]
  filters: {
    assignee: string
    period:   string
    tagId:    string
    search:   string
  }
}

export function KanbanBoard({
  board, initialTasks, currentUserId, currentUserName, teamMembers, filters,
}: KanbanBoardProps) {
  const { error: toastError } = useToast()
  const [tasks,        setTasks]        = useState<TaskData[]>(initialTasks)
  const [activeTask,   setActiveTask]   = useState<TaskData | null>(null)
  const [formOpen,     setFormOpen]     = useState(false)
  const [defaultColId, setDefaultColId] = useState<string>('')
  const [detailTask,   setDetailTask]   = useState<TaskData | null>(null)
  const [lists,        setLists]        = useState<TaskList[]>([])
  const [tags,         setTags]         = useState<TaskTag[]>([])
  // O GET traz no máx. 100 cards (embed caro); acima disso vem { truncado, total }.
  const [truncadoTotal, setTruncadoTotal] = useState<number | null>(null)

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  const columns = useMemo(
    () => [...board.kanban_columns].sort((a, b) => a.position - b.position),
    [board.kanban_columns]
  )

  const fetchTasks = useCallback(async () => {
    const params = new URLSearchParams({ board_id: board.id })
    // Inclui as subtarefas no quadro (pedido do dono): sem isto o GET só traz
    // as tarefas-raiz. Cada subtarefa aparece como card na sua própria coluna.
    params.set('parent', 'all')
    if (filters.assignee !== 'all') params.set('assignee', filters.assignee)
    if (filters.period)             params.set('period',   filters.period)
    if (filters.tagId)              params.set('tag_id',   filters.tagId)
    if (filters.search)             params.set('search',   filters.search)

    const res  = await fetch(`/api/tasks?${params}`)
    const data = await res.json()
    if (res.ok) {
      setTasks(data.tasks ?? [])
      setTruncadoTotal(data.truncado ? data.total : null)
    }
  }, [board.id, filters])

  useEffect(() => { fetchTasks() }, [fetchTasks])

  // Buscar listas e tags para o modal de detalhe
  useEffect(() => {
    Promise.all([
      fetch('/api/task-lists').then(r => r.json()),
      fetch('/api/task-tags').then(r => r.json()),
    ]).then(([l, t]) => {
      setLists(l.lists ?? [])
      setTags(t.tags ?? [])
    })
  }, [])

  const tasksForColumn = useCallback(
    (colId: string) => tasks.filter(t => t.kanban_column_id === colId),
    [tasks]
  )

  const handleDragStart = useCallback((event: DragStartEvent) => {
    setActiveTask(tasks.find(t => t.id === event.active.id) ?? null)
  }, [tasks])

  const handleDragEnd = useCallback(async (event: DragEndEvent) => {
    const { active, over } = event
    if (!over || active.id === over.id) { setActiveTask(null); return }

    const taskId   = active.id as string
    const targetId = over.id   as string

    const targetCol  = columns.find(c => c.id === targetId)
    const targetTask = tasks.find(t => t.id === targetId)
    const destColId  = targetCol?.id ?? targetTask?.kanban_column_id

    if (!destColId) { setActiveTask(null); return }

    // Verificar se está indo para a última coluna (Concluída) ou saindo dela
    const lastCol = columns[columns.length - 1]
    const isMovingToConcluida = destColId === lastCol?.id
    const movedTask = tasks.find(t => t.id === taskId)
    const wasCompleted = !!movedTask?.completed_at

    const patchBody: Record<string, unknown> = { kanban_column_id: destColId }
    if (isMovingToConcluida && !wasCompleted) {
      patchBody.completed_at = new Date().toISOString()
    } else if (!isMovingToConcluida && wasCompleted) {
      patchBody.completed_at = null
    }

    // Optimistic update
    setTasks(prev => prev.map(t =>
      t.id === taskId ? {
        ...t,
        kanban_column_id: destColId,
        completed_at: isMovingToConcluida && !wasCompleted
          ? new Date().toISOString()
          : !isMovingToConcluida && wasCompleted ? null : t.completed_at,
      } : t
    ))
    setActiveTask(null)

    const res = await fetch(`/api/tasks/${taskId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patchBody),
    })
    if (!res.ok) {
      toastError('Erro', 'Não foi possível mover a tarefa')
      fetchTasks()
    }
  }, [columns, tasks, toastError, fetchTasks])

  const openNewTask = useCallback((colId: string) => {
    setDefaultColId(colId)
    setFormOpen(true)
  }, [])

  const handleTaskClick = useCallback((task: TaskData) => {
    setDetailTask(task)
  }, [])

  const handleSaved = useCallback(() => {
    fetchTasks()
    // Atualiza a tarefa aberta no detalhe se ela ainda existe
    setDetailTask(prev => {
      if (!prev) return null
      // Será re-populated na próxima vez que fetchTasks atualizar tasks
      return prev
    })
  }, [fetchTasks])

  return (
    <>
      <div className="flex h-full flex-col gap-3">
        {/* Aviso discreto de truncamento: o quadro não pagina, então acima do teto
            avisamos em vez de esconder cards em silêncio. */}
        {truncadoTotal !== null && (
          <p className="shrink-0 text-xs text-muted-foreground">
            Mostrando {tasks.length} de {truncadoTotal} tarefas — refine os filtros para ver o restante.
          </p>
        )}

        {/* Abaixo de xl (onde o calendário fica oculto): lista de próximos prazos */}
        <ProximosPrazos tasks={tasks} onTaskClick={handleTaskClick} />

        <div className="flex min-h-0 flex-1 gap-4">
          {/* Colunas Kanban */}
          <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
            <div className="flex flex-1 gap-4 overflow-x-auto pb-4 pt-2 h-full">
              {columns.map(col => (
                <KanbanColumn
                  key={col.id}
                  id={col.id}
                  name={col.name}
                  color={col.color}
                  tasks={tasksForColumn(col.id)}
                  onNewTask={openNewTask}
                  onTaskClick={handleTaskClick}
                />
              ))}
            </div>

            <DragOverlay>
              {activeTask && (
                <div className="rotate-2 opacity-90">
                  <TaskCard task={activeTask} />
                </div>
              )}
            </DragOverlay>
          </DndContext>

          {/* Calendário (xl+) */}
          <div className="hidden xl:block pt-2 overflow-y-auto shrink-0">
            <KanbanCalendar tasks={tasks} columns={columns} />
          </div>
        </div>
      </div>

      {/* Modal: nova tarefa */}
      <TaskFormModal
        open={formOpen}
        onClose={() => setFormOpen(false)}
        onSaved={() => { setFormOpen(false); fetchTasks() }}
        currentUserId={currentUserId}
        currentUserName={currentUserName}
        teamMembers={teamMembers}
        defaultBoardId={board.id}
        defaultColumnId={defaultColId}
      />

      {/* Modal: detalhe / edição de tarefa */}
      {detailTask && (
        <TaskDetailModal
          open={!!detailTask}
          task={detailTask}
          boards={[board]}
          lists={lists}
          tags={tags}
          teamMembers={teamMembers}
          currentUserId={currentUserId}
          currentUserName={currentUserName}
          onClose={() => setDetailTask(null)}
          onSaved={() => { handleSaved(); setDetailTask(null) }}
        />
      )}
    </>
  )
}
