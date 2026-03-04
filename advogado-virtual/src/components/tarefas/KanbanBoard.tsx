'use client'

import { useState, useCallback, useEffect } from 'react'
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  type DragStartEvent,
  type DragEndEvent,
} from '@dnd-kit/core'
import { useToast } from '@/components/ui/toast'
import { KanbanColumn } from './KanbanColumn'
import { KanbanCalendar } from './KanbanCalendar'
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

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } })
  )

  const columns = [...board.kanban_columns].sort((a, b) => a.position - b.position)

  const fetchTasks = useCallback(async () => {
    const params = new URLSearchParams({ board_id: board.id })
    if (filters.assignee !== 'all') params.set('assignee', filters.assignee)
    if (filters.period)             params.set('period',   filters.period)
    if (filters.tagId)              params.set('tag_id',   filters.tagId)
    if (filters.search)             params.set('search',   filters.search)

    const res  = await fetch(`/api/tasks?${params}`)
    const data = await res.json()
    if (res.ok) setTasks(data.tasks ?? [])
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

  function tasksForColumn(colId: string) {
    return tasks.filter(t => t.kanban_column_id === colId)
  }

  function handleDragStart(event: DragStartEvent) {
    const task = tasks.find(t => t.id === event.active.id)
    setActiveTask(task ?? null)
  }

  async function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event
    if (!over || active.id === over.id) { setActiveTask(null); return }

    const taskId   = active.id as string
    const targetId = over.id   as string

    const targetCol  = columns.find(c => c.id === targetId)
    const targetTask = tasks.find(t => t.id === targetId)
    const destColId  = targetCol?.id ?? targetTask?.kanban_column_id

    if (!destColId) { setActiveTask(null); return }

    // Optimistic update
    setTasks(prev => prev.map(t =>
      t.id === taskId ? { ...t, kanban_column_id: destColId } : t
    ))
    setActiveTask(null)

    const res = await fetch(`/api/tasks/${taskId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kanban_column_id: destColId }),
    })
    if (!res.ok) {
      toastError('Erro', 'Não foi possível mover a tarefa')
      fetchTasks()
    }
  }

  function openNewTask(colId: string) {
    setDefaultColId(colId)
    setFormOpen(true)
  }

  function handleSaved() {
    fetchTasks()
    // Atualiza a tarefa aberta no detalhe se ela ainda existe
    setDetailTask(prev => {
      if (!prev) return null
      // Será re-populated na próxima vez que fetchTasks atualizar tasks
      return prev
    })
  }

  return (
    <>
      <div className="flex h-full gap-4">
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
                onNewTask={() => openNewTask(col.id)}
                onTaskClick={task => setDetailTask(task)}
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

        {/* Calendários */}
        <div className="hidden xl:block pt-2 overflow-y-auto shrink-0">
          <KanbanCalendar tasks={tasks} columns={columns} />
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
          onClose={() => setDetailTask(null)}
          onSaved={() => { handleSaved(); setDetailTask(null) }}
        />
      )}
    </>
  )
}
