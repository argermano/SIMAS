'use client'

import { useDroppable } from '@dnd-kit/core'
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { Plus } from 'lucide-react'
import { TaskCard, type TaskData } from './TaskCard'
import { cn } from '@/lib/utils'

interface KanbanColumnProps {
  id:        string
  name:      string
  color?:    string | null
  tasks:     TaskData[]
  onNewTask: () => void
  onTaskClick: (task: TaskData) => void
}

export function KanbanColumn({ id, name, color, tasks, onNewTask, onTaskClick }: KanbanColumnProps) {
  const { setNodeRef, isOver } = useDroppable({ id })

  const count = tasks.length

  return (
    <div className="flex w-72 shrink-0 flex-col rounded-xl bg-gray-100">
      {/* Cabeçalho */}
      <div className="flex items-center justify-between px-3 py-3">
        <div className="flex items-center gap-2">
          {color && (
            <span
              className="h-2.5 w-2.5 rounded-full"
              style={{ backgroundColor: color }}
            />
          )}
          <span className="text-sm font-semibold text-gray-700">{name}</span>
          <span className="rounded-full bg-gray-300 px-2 py-0.5 text-xs font-semibold text-gray-600">
            {count > 40 ? '40+' : count}
          </span>
        </div>

        <button
          onClick={onNewTask}
          className="rounded-md p-1 text-gray-400 hover:bg-gray-200 hover:text-gray-600 transition-colors"
          aria-label="Nova tarefa"
        >
          <Plus className="h-4 w-4" />
        </button>
      </div>

      {/* Cards */}
      <div
        ref={setNodeRef}
        className={cn(
          'flex flex-1 flex-col gap-2 overflow-y-auto px-2 pb-2 min-h-[120px]',
          isOver && 'bg-blue-50 rounded-b-xl'
        )}
      >
        <SortableContext items={tasks.map(t => t.id)} strategy={verticalListSortingStrategy}>
          {tasks.map(task => (
            <TaskCard
              key={task.id}
              task={task}
              onClick={() => onTaskClick(task)}
            />
          ))}
        </SortableContext>

        {/* Botão "Nova atividade" quando vazio */}
        {tasks.length === 0 && (
          <button
            onClick={onNewTask}
            className="mt-1 flex items-center justify-center gap-2 rounded-lg border-2 border-dashed border-gray-300 py-4 text-sm text-gray-400 hover:border-gray-400 hover:text-gray-500 transition-colors"
          >
            <Plus className="h-4 w-4" />
            NOVA ATIVIDADE
          </button>
        )}
      </div>
    </div>
  )
}
