'use client'

import { useState, useEffect } from 'react'
import { Dialog } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Select } from '@/components/ui/select'
import { useToast } from '@/components/ui/toast'
import { Loader2, Plus, Tag } from 'lucide-react'

interface Board { id: string; name: string; kanban_columns: Column[] }
interface Column { id: string; name: string; position: number }
interface TaskList { id: string; name: string }
interface TaskTag { id: string; name: string; color: string }
interface User { id: string; nome: string }

interface TeamMember { id: string; nome: string }

interface TaskFormModalProps {
  open:               boolean
  onClose:            () => void
  onSaved:            () => void
  currentUserId:      string
  currentUserName:    string
  teamMembers?:       TeamMember[]
  defaultBoardId?:    string
  defaultColumnId?:   string
}

const PRIORITY_OPTIONS = [
  { value: 'baixa',   label: 'Baixa' },
  { value: 'media',   label: 'Média' },
  { value: 'alta',    label: 'Alta' },
  { value: 'urgente', label: 'Urgente' },
]

export function TaskFormModal({
  open, onClose, onSaved,
  currentUserId, currentUserName, teamMembers,
  defaultBoardId, defaultColumnId,
}: TaskFormModalProps) {
  const { success, error: toastError } = useToast()

  const [description,   setDescription]   = useState('')
  const [dueDate,       setDueDate]        = useState('')
  const [taskListId,    setTaskListId]     = useState('')
  const [assigneeId,    setAssigneeId]     = useState(currentUserId)
  const [priority,      setPriority]       = useState<'baixa'|'media'|'alta'|'urgente'>('media')
  const [boardId,       setBoardId]        = useState(defaultBoardId ?? '')
  const [columnId,      setColumnId]       = useState(defaultColumnId ?? '')
  const [newListName,   setNewListName]    = useState('')
  const [showNewList,   setShowNewList]    = useState(false)
  const [selectedTags,  setSelectedTags]   = useState<string[]>([])
  const [showTags,      setShowTags]       = useState(false)
  const [saving,        setSaving]         = useState(false)
  const [savingList,    setSavingList]     = useState(false)

  const [boards,    setBoards]    = useState<Board[]>([])
  const [lists,     setLists]     = useState<TaskList[]>([])
  const [tags,      setTags]      = useState<TaskTag[]>([])

  useEffect(() => {
    if (!open) return
    Promise.all([
      fetch('/api/kanban-boards').then(r => r.json()),
      fetch('/api/task-lists').then(r => r.json()),
      fetch('/api/task-tags').then(r => r.json()),
    ]).then(([b, l, t]) => {
      setBoards(b.boards ?? [])
      setLists(l.lists ?? [])
      setTags(t.tags ?? [])

      if (!boardId && b.boards?.[0]) {
        setBoardId(b.boards[0].id)
        setColumnId(b.boards[0].kanban_columns?.[0]?.id ?? '')
      }
      if (!taskListId && l.lists?.[0]) setTaskListId(l.lists[0].id)
    })
  }, [open])

  const currentBoard   = boards.find(b => b.id === boardId)
  const columnOptions  = (currentBoard?.kanban_columns ?? [])
    .sort((a, b) => a.position - b.position)
    .map(c => ({ value: c.id, label: c.name }))

  function handleBoardChange(id: string) {
    setBoardId(id)
    const b = boards.find(b => b.id === id)
    const firstCol = [...(b?.kanban_columns ?? [])].sort((a, b) => a.position - b.position)[0]
    setColumnId(firstCol?.id ?? '')
  }

  async function handleCreateList() {
    if (!newListName.trim()) return
    setSavingList(true)
    try {
      const res  = await fetch('/api/task-lists', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newListName.trim() }),
      })
      const data = await res.json()
      if (res.ok) {
        setLists(prev => [...prev, data.list])
        setTaskListId(data.list.id)
        setNewListName('')
        setShowNewList(false)
      }
    } finally {
      setSavingList(false)
    }
  }

  function toggleTag(id: string) {
    setSelectedTags(prev =>
      prev.includes(id) ? prev.filter(t => t !== id) : [...prev, id]
    )
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!description.trim()) return

    setSaving(true)
    try {
      const res  = await fetch('/api/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          description:      description.trim(),
          due_date:         dueDate || null,
          task_list_id:     taskListId || null,
          assignee_id:      assigneeId,
          priority,
          kanban_board_id:  boardId  || null,
          kanban_column_id: columnId || null,
          tag_ids:          selectedTags,
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        toastError('Erro', data.error ?? 'Não foi possível criar a tarefa')
        return
      }
      success('Tarefa criada!', description.slice(0, 60))
      onSaved()
      handleClose()
    } finally {
      setSaving(false)
    }
  }

  function handleClose() {
    setDescription('')
    setDueDate('')
    setNewListName('')
    setShowNewList(false)
    setSelectedTags([])
    setShowTags(false)
    onClose()
  }

  return (
    <Dialog
      open={open}
      onClose={handleClose}
      title="Adicionar tarefa"
      size="lg"
      footer={
        <>
          <Button variant="secondary" size="sm" onClick={handleClose} disabled={saving}>
            Cancelar
          </Button>
          <Button size="sm" onClick={handleSubmit as never} loading={saving}>
            Salvar
          </Button>
        </>
      }
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        {/* Descrição */}
        <Textarea
          label="Descrição da tarefa"
          required
          rows={3}
          value={description}
          onChange={e => setDescription(e.target.value)}
          placeholder="Descreva a tarefa..."
        />

        {/* Tags */}
        <div>
          <button
            type="button"
            onClick={() => setShowTags(v => !v)}
            className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-700"
          >
            <Tag className="h-4 w-4" />
            {selectedTags.length > 0 ? `${selectedTags.length} etiqueta(s) selecionada(s)` : 'Adicionar etiquetas'}
          </button>
          {showTags && tags.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-2">
              {tags.map(tag => (
                <button
                  key={tag.id}
                  type="button"
                  onClick={() => toggleTag(tag.id)}
                  className="flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium text-white transition-opacity"
                  style={{
                    backgroundColor: tag.color,
                    opacity: selectedTags.includes(tag.id) ? 1 : 0.4,
                  }}
                >
                  {tag.name}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Data + Lista */}
        <div className="grid grid-cols-2 gap-3">
          <Input
            label="Data de vencimento"
            type="date"
            value={dueDate}
            onChange={e => setDueDate(e.target.value)}
          />

          <div className="space-y-1.5">
            <Select
              label="Lista de tarefas"
              value={taskListId}
              onChange={e => {
                if (e.target.value === '__new__') { setShowNewList(true) }
                else setTaskListId(e.target.value)
              }}
              options={[
                ...lists.map(l => ({ value: l.id, label: l.name })),
                { value: '__new__', label: '+ Criar nova lista' },
              ]}
              placeholder="Selecione..."
            />
            {showNewList && (
              <div className="flex gap-2">
                <input
                  autoFocus
                  className="h-9 flex-1 rounded-md border border-gray-300 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary-800"
                  placeholder="Nome da lista"
                  value={newListName}
                  onChange={e => setNewListName(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); handleCreateList() } }}
                />
                <Button size="sm" onClick={handleCreateList} loading={savingList} type="button">
                  <Plus className="h-4 w-4" />
                </Button>
              </div>
            )}
          </div>
        </div>

        {/* Responsável + Prioridade */}
        <div className="grid grid-cols-2 gap-3">
          <Select
            label="Responsável"
            required
            value={assigneeId}
            onChange={e => setAssigneeId(e.target.value)}
            options={
              teamMembers && teamMembers.length > 0
                ? teamMembers.map(m => ({ value: m.id, label: m.nome }))
                : [{ value: currentUserId, label: currentUserName }]
            }
          />

          <Select
            label="Prioridade"
            required
            value={priority}
            onChange={e => setPriority(e.target.value as typeof priority)}
            options={PRIORITY_OPTIONS}
          />
        </div>

        {/* Quadro + Coluna */}
        <div className="grid grid-cols-2 gap-3">
          <Select
            label="Quadro Kanban"
            value={boardId}
            onChange={e => handleBoardChange(e.target.value)}
            options={boards.map(b => ({ value: b.id, label: b.name }))}
            placeholder="Selecione..."
          />

          <Select
            label="Coluna"
            value={columnId}
            onChange={e => setColumnId(e.target.value)}
            options={columnOptions}
            placeholder="Selecione..."
            disabled={!boardId}
          />
        </div>
      </form>
    </Dialog>
  )
}
