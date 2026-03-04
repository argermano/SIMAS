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
import { arrayMove } from '@dnd-kit/sortable'
import { useToast } from '@/components/ui/toast'
import { KanbanColumn } from './KanbanColumn'
import { TaskCard, type TaskData } from './TaskCard'
import { TaskFormModal } from './TaskFormModal'

interface Column {
  id:       string
  name:     string
  position: number
  color?:   string | null
}

interface Board {
  id:              string
  name:            string
  kanban_columns:  Column[]
}

interface KanbanBoardProps {
  board:           Board
  initialTasks:    TaskData[]
  currentUserId:   string
  currentUserName: string
  filters: {
    assignee: string   // 'all' | 'me'
    period:   string   // '' | 'month' | 'week' | 'today'
    tagId:    string   // '' | uuid
    search:   string
  }
}

export function KanbanBoard({
  board, initialTasks, currentUserId, currentUserName, filters,
}: KanbanBoardProps) {
  const { error: toastError } = useToast()
  const [tasks,         setTasks]         = useState<TaskData[]>(initialTasks)
  const [activeTask,    setActiveTask]     = useState<TaskData | null>(null)
  const [formOpen,      setFormOpen]       = useState(false)
  const [defaultColId,  setDefaultColId]   = useState<string>('')
  const [loading,       setLoading]        = useState(false)

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } })
  )

  const columns = [...board.kanban_columns].sort((a, b) => a.position - b.position)

  const fetchTasks = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams({ board_id: board.id })
      if (filters.assignee !== 'all')  params.set('assignee', filters.assignee)
      if (filters.period)              params.set('period',   filters.period)
      if (filters.tagId)               params.set('tag_id',   filters.tagId)
      if (filters.search)              params.set('search',   filters.search)

      const res  = await fetch(`/api/tasks?${params}`)
      const data = await res.json()
      if (res.ok) setTasks(data.tasks ?? [])
    } finally {
      setLoading(false)
    }
  }, [board.id, filters])

  useEffect(() => { fetchTasks() }, [fetchTasks])

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

    const taskId    = active.id as string
    const targetId  = over.id  as string

    // Determina coluna destino
    const targetCol = columns.find(c => c.id === targetId)
    const targetTask = tasks.find(t => t.id === targetId)
    const destColId = targetCol?.id ?? targetTask?.kanban_column_id

    if (!destColId) { setActiveTask(null); return }

    // Optimistic update
    setTasks(prev => prev.map(t =>
      t.id === taskId ? { ...t, kanban_column_id: destColId } : t
    ))
    setActiveTask(null)

    // Sync backend
    const res = await fetch(`/api/tasks/${taskId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kanban_column_id: destColId }),
    })
    if (!res.ok) {
      toastError('Erro', 'Não foi possível mover a tarefa')
      fetchTasks() // revert
    }
  }

  function openNewTask(colId: string) {
    setDefaultColId(colId)
    setFormOpen(true)
  }

  return (
    <>
      <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
        <div className="flex gap-4 overflow-x-auto pb-4 pt-2">
          {columns.map(col => (
            <KanbanColumn
              key={col.id}
              id={col.id}
              name={col.name}
              color={col.color}
              tasks={tasksForColumn(col.id)}
              onNewTask={() => openNewTask(col.id)}
              onTaskClick={() => {}}
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

      <TaskFormModal
        open={formOpen}
        onClose={() => setFormOpen(false)}
        onSaved={() => { setFormOpen(false); fetchTasks() }}
        currentUserId={currentUserId}
        currentUserName={currentUserName}
        defaultBoardId={board.id}
        defaultColumnId={defaultColId}
      />
    </>
  )
}
