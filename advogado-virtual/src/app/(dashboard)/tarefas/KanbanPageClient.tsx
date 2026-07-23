'use client'

import { useState, useCallback, useMemo, useEffect, useRef } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Search, ChevronDown, ChevronLeft, ChevronRight, Plus } from 'lucide-react'
import { KanbanBoard } from '@/components/tarefas/KanbanBoard'
import { TaskFormModal } from '@/components/tarefas/TaskFormModal'
import { cn } from '@/lib/utils'

interface Column { id: string; name: string; position: number; color?: string | null }
interface Board  { id: string; name: string; kanban_columns: Column[] }
interface TagItem    { id: string; name: string; color: string }
interface TeamMember { id: string; nome: string }

interface KanbanPageClientProps {
  boards:          Board[]
  tags:            TagItem[]
  teamMembers:     TeamMember[]
  currentUserId:   string
  currentUserName: string
}

// Navegador de mês do quadro (Astrea: "‹ JULHO 2026 ›"). O mês é 'YYYY-MM' e
// alimenta o filtro `month` da API (recorte por vencimento). '' = todos os períodos
// (tarefas sem vencimento ficam fora do recorte de mês, então mantemos essa saída).
function mesAtual(): string {
  const n = new Date()
  return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}`
}

function rotuloMes(m: string): string {
  if (!m) return 'Todos os períodos'
  const [ano, mes] = m.split('-').map(Number)
  const s = new Date(ano, mes - 1, 1).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })
  return s.charAt(0).toUpperCase() + s.slice(1)  // "Julho 2026"
}

function deslocarMes(m: string, delta: number): string {
  const n = new Date()
  const [ano, mes] = m ? m.split('-').map(Number) : [n.getFullYear(), n.getMonth() + 1]
  const d = new Date(ano, mes - 1 + delta, 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

export function KanbanPageClient({
  boards, tags, teamMembers, currentUserId, currentUserName,
}: KanbanPageClientProps) {
  const [activeBoardId, setActiveBoardId] = useState(boards[0]?.id ?? '')
  const [assigneeFilter, setAssigneeFilter] = useState('')  // '' = all, 'me', or UUID
  const [monthFilter,    setMonthFilter]    = useState<string>(mesAtual)  // 'YYYY-MM' | '' = todos
  const [tagFilter,      setTagFilter]      = useState('')
  const [search,         setSearch]         = useState('')
  const [searchOpen,     setSearchOpen]     = useState(false)
  const [formOpen,       setFormOpen]       = useState(false)
  const [refreshKey,     setRefreshKey]     = useState(0)

  const activeBoard = boards.find(b => b.id === activeBoardId) ?? boards[0]

  // Map filter value to what the API expects
  const assigneeApiValue = assigneeFilter === '' ? 'all' : assigneeFilter
  const filters = useMemo(
    () => ({ assignee: assigneeApiValue, month: monthFilter, tagId: tagFilter, search }),
    [assigneeApiValue, monthFilter, tagFilter, search]
  )

  const handleSaved = useCallback(() => {
    setFormOpen(false)
    setRefreshKey(k => k + 1)
  }, [])

  const handleFormClose = useCallback(() => setFormOpen(false), [])

  // Deep-link /tarefas?nova=1 (atalho "Nova tarefa" da barra superior): abre o
  // TaskFormModal e limpa o parâmetro da URL depois de abrir.
  const router = useRouter()
  const searchParams = useSearchParams()
  const novaTratada = useRef(false)
  useEffect(() => {
    if (searchParams.get('nova') !== '1') { novaTratada.current = false; return }
    if (novaTratada.current) return
    novaTratada.current = true
    setFormOpen(true)
    router.replace('/tarefas', { scroll: false })
  }, [searchParams, router])

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* ─── Header ─────────────────────────────────────────────────────────── */}
      {/* max-lg:pl-16 reserva espaço para o botão de menu (fixed left-4) no mobile */}
      <div className="border-b border-border bg-card px-6 py-4 max-lg:pl-16">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <h1 className="text-2xl font-bold text-foreground font-heading">Gestão kanban</h1>

            {/* Seletor de quadro */}
            {boards.length > 0 && (
              <div className="relative">
                <select
                  value={activeBoardId}
                  onChange={e => setActiveBoardId(e.target.value)}
                  className="h-8 appearance-none rounded-lg border border-border bg-muted/50 pl-3 pr-8 text-sm font-semibold text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                >
                  {boards.map(b => (
                    <option key={b.id} value={b.id}>{b.name}</option>
                  ))}
                </select>
                <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              </div>
            )}
          </div>

          <button
            onClick={() => setFormOpen(true)}
            className="flex items-center gap-2 rounded-lg bg-primary px-3 py-2 text-sm font-medium text-white hover:bg-primary/90 transition-colors"
          >
            <Plus className="h-4 w-4" />
            Nova tarefa
          </button>
        </div>

        {/* Filtros */}
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {/* Navegador de mês (Astrea: "‹ JULHO 2026 ›"). Default = mês atual; o
              rótulo alterna p/ "Todos os períodos" (para ver tarefas sem vencimento,
              que ficam fora do recorte de mês). */}
          <div className="flex items-center rounded-full border border-border bg-card">
            <button
              type="button"
              onClick={() => setMonthFilter(m => deslocarMes(m, -1))}
              aria-label="Mês anterior"
              className="flex h-8 w-8 items-center justify-center rounded-l-full text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={() => setMonthFilter(m => (m ? '' : mesAtual()))}
              title={monthFilter ? 'Ver todos os períodos' : 'Voltar ao mês atual'}
              className={cn(
                'min-w-[9rem] px-2 text-center text-sm font-medium transition-colors',
                monthFilter ? 'text-foreground' : 'text-muted-foreground'
              )}
            >
              {rotuloMes(monthFilter)}
            </button>
            <button
              type="button"
              onClick={() => setMonthFilter(m => deslocarMes(m, 1))}
              aria-label="Próximo mês"
              className="flex h-8 w-8 items-center justify-center rounded-r-full text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>

          {/* Filtro por responsável */}
          <div className="relative">
            <select
              value={assigneeFilter}
              onChange={e => setAssigneeFilter(e.target.value)}
              className={cn(
                'h-8 appearance-none rounded-full border pl-3 pr-8 text-sm focus:outline-none focus:ring-1 focus:ring-ring',
                assigneeFilter
                  ? 'border-primary bg-primary/5 text-primary font-medium'
                  : 'border-border bg-card text-muted-foreground'
              )}
            >
              <option value="">Todos os responsáveis</option>
              <option value="me">Minhas tarefas</option>
              {teamMembers
                .filter(m => m.id !== currentUserId)
                .map(m => (
                  <option key={m.id} value={m.id}>{m.nome}</option>
                ))
              }
            </select>
            <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-3 w-3 -translate-y-1/2 text-muted-foreground" />
          </div>

          {/* Filtro por tag */}
          <div className="relative">
            <select
              value={tagFilter}
              onChange={e => setTagFilter(e.target.value)}
              className="h-8 appearance-none rounded-full border border-border bg-card pl-3 pr-8 text-sm text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
            >
              <option value="">Todos os tipos</option>
              {tags.map(t => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </select>
            <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-3 w-3 -translate-y-1/2 text-muted-foreground" />
          </div>

          {/* Busca */}
          <button
            onClick={() => setSearchOpen(v => !v)}
            className={cn(
              'flex h-8 items-center gap-1.5 rounded-full border px-3 text-sm transition-colors',
              searchOpen ? 'border-primary bg-primary/5' : 'border-border bg-card text-muted-foreground'
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
              className="h-8 rounded-full border border-border bg-card px-3 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
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
            teamMembers={teamMembers}
            filters={filters}
          />
        ) : (
          <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
            <p className="text-lg">Nenhum quadro encontrado.</p>
            <p className="text-sm">Recarregue a página para criar o quadro padrão.</p>
          </div>
        )}
      </div>

      {/* Modal de nova tarefa (global) */}
      <TaskFormModal
        open={formOpen}
        onClose={handleFormClose}
        onSaved={handleSaved}
        currentUserId={currentUserId}
        currentUserName={currentUserName}
        teamMembers={teamMembers}
        defaultBoardId={activeBoardId}
      />
    </div>
  )
}
