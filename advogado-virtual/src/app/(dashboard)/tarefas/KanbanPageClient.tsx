'use client'

import { useState } from 'react'
import { Search, Tag, ChevronDown, Plus } from 'lucide-react'
import { KanbanBoard } from '@/components/tarefas/KanbanBoard'
import { TaskFormModal } from '@/components/tarefas/TaskFormModal'
import { cn } from '@/lib/utils'

interface Column { id: string; name: string; position: number; color?: string | null }
interface Board  { id: string; name: string; kanban_columns: Column[] }
interface Tag    { id: string; name: string; color: string }

interface KanbanPageClientProps {
  boards:          Board[]
  tags:            Tag[]
  currentUserId:   string
  currentUserName: string
}

const PERIOD_OPTIONS = [
  { value: '',       label: 'Todos os períodos' },
  { value: 'today',  label: 'Hoje' },
  { value: 'week',   label: 'Esta semana' },
  { value: 'month',  label: 'Este mês' },
]

export function KanbanPageClient({
  boards, tags, currentUserId, currentUserName,
}: KanbanPageClientProps) {
  const [activeBoardId, setActiveBoardId] = useState(boards[0]?.id ?? '')
  const [assigneeFilter, setAssigneeFilter] = useState<'all' | 'me'>('all')
  const [periodFilter,   setPeriodFilter]   = useState('')
  const [tagFilter,      setTagFilter]      = useState('')
  const [search,         setSearch]         = useState('')
  const [searchOpen,     setSearchOpen]     = useState(false)
  const [formOpen,       setFormOpen]       = useState(false)
  const [refreshKey,     setRefreshKey]     = useState(0)

  const activeBoard = boards.find(b => b.id === activeBoardId) ?? boards[0]

  const filters = { assignee: assigneeFilter, period: periodFilter, tagId: tagFilter, search }

  const currentPeriodLabel = PERIOD_OPTIONS.find(p => p.value === periodFilter)?.label ?? 'Todos os períodos'

  function handleSaved() {
    setFormOpen(false)
    setRefreshKey(k => k + 1)
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* ─── Header ─────────────────────────────────────────────────────────── */}
      <div className="border-b border-gray-200 bg-white px-6 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <h1 className="text-xl font-bold text-gray-900">Gestão kanban</h1>

            {/* Seletor de quadro */}
            {boards.length > 0 && (
              <div className="relative">
                <select
                  value={activeBoardId}
                  onChange={e => setActiveBoardId(e.target.value)}
                  className="h-8 appearance-none rounded-lg border border-gray-200 bg-gray-50 pl-3 pr-8 text-sm font-semibold text-gray-700 focus:outline-none focus:ring-2 focus:ring-primary-800"
                >
                  {boards.map(b => (
                    <option key={b.id} value={b.id}>{b.name}</option>
                  ))}
                </select>
                <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-400" />
              </div>
            )}
          </div>

          <button
            onClick={() => setFormOpen(true)}
            className="flex items-center gap-2 rounded-lg bg-primary-800 px-3 py-2 text-sm font-medium text-white hover:bg-primary-900 transition-colors"
          >
            <Plus className="h-4 w-4" />
            Nova tarefa
          </button>
        </div>

        {/* Filtros */}
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {/* Período */}
          <div className="relative">
            <select
              value={periodFilter}
              onChange={e => setPeriodFilter(e.target.value)}
              className="h-8 appearance-none rounded-full border border-gray-200 bg-white pl-3 pr-8 text-sm text-gray-600 focus:outline-none focus:ring-1 focus:ring-primary-800"
            >
              {PERIOD_OPTIONS.map(p => (
                <option key={p.value} value={p.value}>{p.label}</option>
              ))}
            </select>
            <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-3 w-3 -translate-y-1/2 text-gray-400" />
          </div>

          {/* Minhas atribuições */}
          <button
            onClick={() => setAssigneeFilter(a => a === 'me' ? 'all' : 'me')}
            className={cn(
              'rounded-full border px-3 py-1 text-sm transition-colors',
              assigneeFilter === 'me'
                ? 'border-primary-800 bg-primary-800 text-white'
                : 'border-gray-200 bg-white text-gray-600 hover:border-gray-300'
            )}
          >
            {assigneeFilter === 'me' ? 'Minhas atribuições' : 'Todas as atribuições'}
          </button>

          {/* Filtro por tag */}
          <div className="relative">
            <select
              value={tagFilter}
              onChange={e => setTagFilter(e.target.value)}
              className="h-8 appearance-none rounded-full border border-gray-200 bg-white pl-3 pr-8 text-sm text-gray-600 focus:outline-none focus:ring-1 focus:ring-primary-800"
            >
              <option value="">Todos os tipos</option>
              {tags.map(t => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </select>
            <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-3 w-3 -translate-y-1/2 text-gray-400" />
          </div>

          {/* Busca */}
          <button
            onClick={() => setSearchOpen(v => !v)}
            className={cn(
              'flex h-8 items-center gap-1.5 rounded-full border px-3 text-sm transition-colors',
              searchOpen ? 'border-primary-800 bg-primary-50' : 'border-gray-200 bg-white text-gray-600'
            )}
          >
            <Search className="h-3.5 w-3.5" />
          </button>

          {searchOpen && (
            <input
              autoFocus
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Buscar tarefas..."
              className="h-8 rounded-full border border-gray-200 bg-white px-3 text-sm focus:outline-none focus:ring-1 focus:ring-primary-800"
            />
          )}
        </div>
      </div>

      {/* ─── Kanban ──────────────────────────────────────────────────────────── */}
      <div className="flex-1 overflow-auto px-6 py-4">
        {activeBoard ? (
          <KanbanBoard
            key={`${activeBoardId}-${refreshKey}`}
            board={activeBoard}
            initialTasks={[]}
            currentUserId={currentUserId}
            currentUserName={currentUserName}
            filters={filters}
          />
        ) : (
          <div className="flex flex-col items-center justify-center py-20 text-gray-400">
            <p className="text-lg">Nenhum quadro encontrado.</p>
            <p className="text-sm">Recarregue a página para criar o quadro padrão.</p>
          </div>
        )}
      </div>

      {/* Modal de nova tarefa (global) */}
      <TaskFormModal
        open={formOpen}
        onClose={() => setFormOpen(false)}
        onSaved={handleSaved}
        currentUserId={currentUserId}
        currentUserName={currentUserName}
        defaultBoardId={activeBoardId}
      />
    </div>
  )
}
