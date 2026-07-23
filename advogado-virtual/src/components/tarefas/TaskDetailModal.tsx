'use client'

import { useState, useEffect, type ReactNode, type ComponentType } from 'react'
import { useRouter } from 'next/navigation'
import { Textarea } from '@/components/ui/textarea'
import { Select } from '@/components/ui/select'
import { Button } from '@/components/ui/button'
import { useToast } from '@/components/ui/toast'
import { ConfirmDialog } from '@/components/ui/dialog'
import {
  X, Calendar, User, Users, Flag, Layers, Tag,
  CheckCircle2, Trash2, Loader2, Pencil, Check, ExternalLink,
  MessageSquare, History, FileText, ListChecks,
  FilePen, CalendarPlus, FolderOpen, Scale,
  ChevronDown, ChevronRight, BookOpen,
} from 'lucide-react'
import type { AcaoConcreta } from '@/lib/tarefas/acao'
import { cn } from '@/lib/utils'
import type { TaskData } from './TaskCard'
import { VinculoPicker, type VinculoSelecionado } from './VinculoPicker'
import { VinculoAssistente } from './VinculoAssistente'
import { resolverVinculoView, ROTULO_TIPO, type VinculoView } from '@/lib/tarefas/vinculo'
import { ComentariosSecao, type Comentario } from './ComentariosSecao'
import { SubtarefasSecao } from './SubtarefasSecao'
import { AbaHistorico } from './detalhe/AbaHistorico'
import { CardPublicacao } from './detalhe/CardPublicacao'

function vinculoParaSelecionado(v: VinculoView | null): VinculoSelecionado | null {
  return v ? { tipo: v.tipo, id: v.id, label: v.label, sublabel: v.sublabel } : null
}

// Alvo pré-resolvido do botão "Resolver" (POST /api/tasks/[id]/acao).
interface AcaoInfo {
  acao:   AcaoConcreta
  rotulo: string
  href:   string | null
  // Peça sem caso: pendência de vínculo + contexto p/ o assistente (PART 2).
  pendencia?:   'vincular' | null
  clienteId?:   string | null
  clienteNome?: string | null
  processoId?:  string | null
  // Pré-criação de caso (1 clique) + área inferida pelos dados do processo.
  podeCriarCaso?:    boolean
  areaInferida?:     string | null
  areaInferidaNome?: string | null
  confiancaArea?:    'alta' | 'baixa' | null
}

// Ícone por ação (rótulo vem da rota). Mantém árvore de ícones estática.
const ACAO_ICON: Record<AcaoConcreta, ComponentType<{ className?: string }>> = {
  peca:        FilePen,
  agendamento: CalendarPlus,
  documento:   FolderOpen,
  processo:    Scale,
}

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
  currentUserId?:   string
  currentUserName?: string
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
  baixa:   'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300',
  media:   'bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300',
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
  task, boards, lists, tags, teamMembers, currentUserId, currentUserName, open, onClose, onSaved,
}: TaskDetailModalProps) {
  const { success, error: toastError } = useToast()
  const router = useRouter()

  const [description,  setDescription]  = useState(task.description)
  const [dueDate,      setDueDate]       = useState(toInputDate(task.due_date))
  const [priority,     setPriority]      = useState(task.priority)
  const [assigneeId,   setAssigneeId]    = useState(task.assignee_id ?? task.users?.id ?? '')
  const [extraAssignees, setExtraAssignees] = useState<string[]>(
    (task.task_assignees ?? []).map(a => a.user_id)
  )
  const [boardId,      setBoardId]       = useState(task.kanban_board_id ?? '')
  const [columnId,     setColumnId]      = useState(task.kanban_column_id ?? '')
  const [taskListId,   setTaskListId]    = useState(task.task_list_id ?? '')
  const [selectedTags, setSelectedTags]  = useState<string[]>(
    (task.task_tag_links ?? []).map(l => l.tag_id)
  )
  const vinculoSalvo = resolverVinculoView(task)
  const [vinculo,      setVinculo]       = useState<VinculoSelecionado | null>(vinculoParaSelecionado(vinculoSalvo))
  const [editingDesc,  setEditingDesc]   = useState(false)
  const [saving,       setSaving]        = useState(false)
  const [completing,   setCompleting]    = useState(false)
  const [confirmDel,   setConfirmDel]    = useState(false)
  const [deleting,     setDeleting]      = useState(false)
  const [isCompleted,  setIsCompleted]   = useState(!!task.completed_at)

  // ── Abas de paridade (Comentários / Histórico / Publicação) ──
  const publicacaoId = task.origin_reference?.startsWith('publicacao:')
    ? task.origin_reference.slice('publicacao:'.length)
    : null
  type Aba = 'comentarios' | 'subtarefas' | 'historico' | 'publicacao'
  const [activeTab,        setActiveTab]        = useState<Aba>(publicacaoId ? 'publicacao' : 'comentarios')
  const [comentarios,      setComentarios]      = useState<Comentario[] | null>(null)
  const [loadingComments,  setLoadingComments]  = useState(false)
  const [subCount,         setSubCount]         = useState<number | null>(null)

  // Botão "Resolver": ação classificada + alvo pré-resolvido (POST .../acao).
  // Buscado ao abrir; cacheado no estado (a rota não persiste nada).
  const [acaoInfo,   setAcaoInfo]   = useState<AcaoInfo | null>(null)
  const [acaoLoading, setAcaoLoading] = useState(false)

  // Resetar estado quando a tarefa mudar
  useEffect(() => {
    setDescription(task.description)
    setDueDate(toInputDate(task.due_date))
    setPriority(task.priority)
    setAssigneeId(task.assignee_id ?? task.users?.id ?? '')
    setExtraAssignees((task.task_assignees ?? []).map(a => a.user_id))
    setBoardId(task.kanban_board_id ?? '')
    setColumnId(task.kanban_column_id ?? '')
    setTaskListId(task.task_list_id ?? '')
    setSelectedTags((task.task_tag_links ?? []).map(l => l.tag_id))
    setVinculo(vinculoParaSelecionado(resolverVinculoView(task)))
    setIsCompleted(!!task.completed_at)
    setEditingDesc(false)
    setActiveTab(publicacaoId ? 'publicacao' : 'comentarios')
    setComentarios(null)
    setSubCount(null)
    setAcaoInfo(null)
  }, [task.id])

  // Alvo do "Resolver": classifica a tarefa e resolve a URL de destino (ou a
  // pendência de vínculo). Só para tarefas não concluídas. Best-effort.
  async function recarregarAcao() {
    setAcaoLoading(true)
    try {
      const res = await fetch(`/api/tasks/${task.id}/acao`, { method: 'POST' })
      if (res.ok) {
        const d = await res.json().catch(() => null)
        if (d?.acao) {
          setAcaoInfo({
            acao: d.acao, rotulo: d.rotulo, href: d.href ?? null,
            pendencia: d.pendencia ?? null,
            clienteId: d.clienteId ?? null, clienteNome: d.clienteNome ?? null, processoId: d.processoId ?? null,
            podeCriarCaso: d.podeCriarCaso ?? false,
            areaInferida: d.areaInferida ?? null, areaInferidaNome: d.areaInferidaNome ?? null,
            confiancaArea: d.confiancaArea ?? null,
          })
        }
      }
    } catch {
      // silencioso — o botão simplesmente não aparece
    } finally {
      setAcaoLoading(false)
    }
  }

  useEffect(() => {
    if (!open || task.completed_at) return
    void recarregarAcao()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [task.id, open, task.completed_at])

  // Marca "visto" ao abrir: zera esta tarefa no sino de comentários novos (os
  // comentários de colegas anteriores a agora deixam de me alertar). Best-effort.
  useEffect(() => {
    if (!open) return
    fetch(`/api/tasks/${task.id}/visto`, { method: 'POST' }).catch(() => {})
  }, [task.id, open])

  // Carregar comentários ao abrir/trocar de tarefa (alimenta o badge de contagem).
  useEffect(() => {
    if (!open) return
    let vivo = true
    setLoadingComments(true)
    ;(async () => {
      try {
        const res = await fetch(`/api/tasks/${task.id}/comentarios`)
        if (!vivo) return
        if (res.ok) {
          const d = await res.json().catch(() => ({}))
          setComentarios((d.comentarios ?? (Array.isArray(d) ? d : [])) as Comentario[])
        } else {
          setComentarios([])
        }
      } catch {
        if (vivo) setComentarios([])
      } finally {
        if (vivo) setLoadingComments(false)
      }
    })()
    return () => { vivo = false }
  }, [task.id, open])

  // Contagem de subtarefas p/ o badge da aba (a lista completa é carregada na aba).
  useEffect(() => {
    if (!open) return
    let vivo = true
    ;(async () => {
      try {
        const res = await fetch(`/api/tasks/${task.id}/subtarefas`)
        if (!vivo) return
        const d = await res.json().catch(() => ({}))
        setSubCount(((d.subtarefas ?? []) as unknown[]).length)
      } catch {
        if (vivo) setSubCount(null)
      }
    })()
    return () => { vivo = false }
  }, [task.id, open])

  if (!open) return null

  const currentBoard  = boards.find(b => b.id === boardId)
  const columnOptions = [...(currentBoard?.kanban_columns ?? [])]
    .sort((a, b) => a.position - b.position)
    .map(c => ({ value: c.id, label: c.name }))

  const allAssignees = [
    task.users ? { id: task.users.id, nome: task.users.nome } : null,
    ...(task.task_assignees ?? []).map(a => a.users),
  ].filter(Boolean) as { id: string; nome: string }[]

  // Responsáveis "ao vivo" (reflete a edição em curso): principal + extras.
  // Resolve nomes pela equipe; cai no dado salvo da task quando disponível.
  const nomeDoMembro = (uid: string) =>
    teamMembers?.find(m => m.id === uid)?.nome
    ?? allAssignees.find(a => a.id === uid)?.nome
    ?? '—'
  const allAssigneesLive = [
    assigneeId ? { id: assigneeId, nome: nomeDoMembro(assigneeId) } : null,
    ...extraAssignees
      .filter(uid => uid !== assigneeId)
      .map(uid => ({ id: uid, nome: nomeDoMembro(uid) })),
  ].filter(Boolean) as { id: string; nome: string }[]

  function toggleExtra(uid: string) {
    setExtraAssignees(prev =>
      prev.includes(uid) ? prev.filter(u => u !== uid) : [...prev, uid]
    )
  }

  // Trocar o principal: o anterior NÃO some da tarefa — vira co-responsável
  // (extra). Sem isto, promover um extra a principal descartava o antigo em
  // silêncio. O novo principal sai dos extras p/ não duplicar (o toggle abaixo
  // já o esconde, e o save filtra uid !== assigneeId).
  function handlePrincipalChange(novo: string) {
    setExtraAssignees(prev => {
      const semNovo = prev.filter(uid => uid !== novo)
      return assigneeId && assigneeId !== novo && !semNovo.includes(assigneeId)
        ? [...semNovo, assigneeId]
        : semNovo
    })
    setAssigneeId(novo)
  }

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
      const payload: Record<string, unknown> = {
        description,
        due_date:         dueDate || null,
        priority,
        assignee_id:      assigneeId || null,
        extra_assignees:  extraAssignees.filter(uid => uid !== assigneeId),
        kanban_board_id:  boardId  || null,
        kanban_column_id: columnId || null,
        task_list_id:     taskListId || null,
        tag_ids:          selectedTags,
        ...extra,
      }
      // Só envia o vínculo se mudou — evita revalidar (e um 400 espúrio se a
      // entidade tiver sido apagada) num salvamento que só mexeu noutro campo.
      const idAtual = vinculo?.id ?? null
      const idSalvo = vinculoSalvo?.id ?? null
      if (idAtual !== idSalvo) {
        payload.vinculo = vinculo ? { tipo: vinculo.tipo, id: vinculo.id } : null
      }
      const res = await fetch(`/api/tasks/${task.id}`, {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
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
      // Ao concluir, mover para última coluna (Concluída); ao reabrir, mover para primeira (A Fazer)
      const cols = [...(currentBoard?.kanban_columns ?? [])].sort((a, b) => a.position - b.position)
      const targetCol = now ? cols[cols.length - 1] : cols[0]
      const patchBody: Record<string, unknown> = { completed_at: now }
      if (targetCol) patchBody.kanban_column_id = targetCol.id
      const res = await fetch(`/api/tasks/${task.id}`, {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patchBody),
      })
      if (res.ok) {
        setIsCompleted(!isCompleted)
        if (targetCol) setColumnId(targetCol.id)
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

          {/* ── Link para item de origem (revisão) ── */}
          {task.origin_reference?.startsWith('revisao_peca:') && (() => {
            const pecaId = task.origin_reference!.replace('revisao_peca:', '')
            const areaMatch = task.description.match(/\(([^)]+)\)/)
            const area = areaMatch?.[1]?.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, '-')
            if (!area) return null
            return (
              <div className="px-6 pb-3">
                <a
                  href={`/${area}/editor/${pecaId}`}
                  className="inline-flex items-center gap-2 rounded-lg border border-primary/20 bg-primary/5 px-3 py-2 text-sm font-medium text-primary hover:bg-primary/10 transition-colors"
                >
                  <ExternalLink className="h-4 w-4" />
                  Abrir peça para revisão
                </a>
              </div>
            )
          })()}

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
                  onChange={e => handlePrincipalChange(e.target.value)}
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

          {/* ── Outros responsáveis (multi) — principal via Select acima ── */}
          {teamMembers && teamMembers.length > 1 && (
            <div className="space-y-2 px-6 pb-4">
              <label className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                <Users className="h-3.5 w-3.5" /> Responsáveis
              </label>
              {/* Todos (principal + extras) com avatar/inicial + nome */}
              <div className="flex flex-wrap gap-1.5">
                {allAssigneesLive.map(u => (
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
              {/* Alternar outros responsáveis (exclui o principal p/ não duplicar) */}
              <div className="flex flex-wrap gap-2 pt-0.5">
                {teamMembers.filter(m => m.id !== assigneeId).map(m => {
                  const on = extraAssignees.includes(m.id)
                  return (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => toggleExtra(m.id)}
                      title={m.nome}
                      className={cn(
                        'flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium transition-colors',
                        on
                          ? 'bg-primary text-white'
                          : 'bg-muted text-muted-foreground hover:bg-muted/70',
                      )}
                    >
                      {on && <Check className="h-3 w-3" />}
                      {m.nome.split(' ')[0]}
                    </button>
                  )
                })}
              </div>
            </div>
          )}

          {/* ── Vínculo: cliente, caso ou processo ── */}
          <div className="px-6 pb-4">
            <VinculoPicker
              value={vinculo}
              onChange={setVinculo}
              removido={!!vinculoSalvo?.removido && vinculo?.id === vinculoSalvo.id}
            />
            {vinculoSalvo && !vinculoSalvo.removido && vinculoSalvo.href && vinculo?.id === vinculoSalvo.id && (
              <a
                href={vinculoSalvo.href}
                className="mt-2 inline-flex items-center gap-1.5 text-xs font-medium text-primary hover:underline"
              >
                <ExternalLink className="h-3.5 w-3.5" />
                Abrir {ROTULO_TIPO[vinculoSalvo.tipo].toLowerCase()}
              </a>
            )}
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

          {/* ── Como foi resolvido antes (guia discreto; só se houver histórico) ── */}
          <HistoricoGuia
            taskId={task.id}
            onAbrirTarefa={(sid) => router.push(`/tarefas?task=${sid}`)}
          />

          {/* ── Abas de paridade (Comentários / Histórico / Publicação) ── */}
          <div className="border-t border-border">
            <div className="flex items-center gap-1 px-4 pt-2" role="tablist">
              <TabButton
                active={activeTab === 'comentarios'}
                onClick={() => setActiveTab('comentarios')}
                icon={<MessageSquare className="h-4 w-4" />}
                label="Comentários"
                badge={comentarios?.length ?? undefined}
              />
              <TabButton
                active={activeTab === 'subtarefas'}
                onClick={() => setActiveTab('subtarefas')}
                icon={<ListChecks className="h-4 w-4" />}
                label="Subtarefas"
                badge={subCount ?? undefined}
              />
              <TabButton
                active={activeTab === 'historico'}
                onClick={() => setActiveTab('historico')}
                icon={<History className="h-4 w-4" />}
                label="Histórico"
              />
              {publicacaoId && (
                <TabButton
                  active={activeTab === 'publicacao'}
                  onClick={() => setActiveTab('publicacao')}
                  icon={<FileText className="h-4 w-4" />}
                  label="Publicação"
                />
              )}
            </div>
            <div className="px-6 py-4">
              {activeTab === 'comentarios' && (
                <ComentariosSecao
                  taskId={task.id}
                  comentarios={comentarios}
                  loading={loadingComments}
                  teamMembers={teamMembers}
                  onCreated={novo => setComentarios(prev => [...(prev ?? []), novo])}
                />
              )}
              {activeTab === 'subtarefas' && (
                <SubtarefasSecao
                  taskId={task.id}
                  teamMembers={teamMembers}
                  currentUserId={currentUserId}
                  currentUserName={currentUserName}
                  defaultBoardId={boardId || boards[0]?.id}
                  onCountChange={setSubCount}
                />
              )}
              {activeTab === 'historico' && <AbaHistorico taskId={task.id} />}
              {activeTab === 'publicacao' && publicacaoId && (
                <CardPublicacao publicacaoId={publicacaoId} />
              )}
            </div>
          </div>

          {/* ── Assistente de vínculo: peça sem caso (AJUDA ATIVA, PART 2) ── */}
          {!isCompleted && acaoInfo?.acao === 'peca' && acaoInfo.pendencia === 'vincular' && (
            <VinculoAssistente
              taskId={task.id}
              titulo={task.description}
              clienteId={acaoInfo.clienteId ?? null}
              clienteNome={acaoInfo.clienteNome ?? null}
              processoId={acaoInfo.processoId ?? null}
              podeCriarCaso={acaoInfo.podeCriarCaso}
              areaInferida={acaoInfo.areaInferida ?? null}
              areaInferidaNome={acaoInfo.areaInferidaNome ?? null}
              confiancaArea={acaoInfo.confiancaArea ?? null}
              onVinculado={() => { void recarregarAcao(); onSaved() }}
            />
          )}

          {/* ── Footer ── */}
          <div className="flex items-center justify-between border-t border-border px-6 py-4">
            <div className="flex flex-wrap gap-2">
              {/* Resolver: leva ao trabalho da tarefa (peça / agenda / dossiê /
                  processo). Não aparece em tarefa concluída. Peça sem caso é
                  tratada pelo assistente acima (não vira botão morto aqui). */}
              {!isCompleted && acaoInfo && acaoInfo.pendencia !== 'vincular' && (() => {
                const Icone = ACAO_ICON[acaoInfo.acao]
                const semAlvo = !acaoInfo.href
                return (
                  <Button
                    size="sm"
                    onClick={() => { if (acaoInfo.href) router.push(acaoInfo.href) }}
                    disabled={semAlvo || acaoLoading}
                    title={semAlvo ? 'Vincule um cliente ou caso a esta tarefa para resolver' : acaoInfo.rotulo}
                  >
                    <Icone className="h-4 w-4" />
                    {acaoInfo.rotulo}
                  </Button>
                )
              })()}

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

interface TabButtonProps {
  active:  boolean
  onClick: () => void
  icon:    ReactNode
  label:   string
  badge?:  number
}

function TabButton({ active, onClick, icon, label, badge }: TabButtonProps) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={cn(
        'flex items-center gap-1.5 rounded-t-md border-b-2 px-3 py-2 text-sm font-medium transition-colors',
        active
          ? 'border-primary text-primary'
          : 'border-transparent text-muted-foreground hover:text-foreground'
      )}
    >
      {icon}
      {label}
      {typeof badge === 'number' && badge > 0 && (
        <span className="ml-0.5 flex h-5 min-w-[1.25rem] items-center justify-center rounded-full bg-primary/10 px-1.5 text-xs font-semibold text-primary">
          {badge}
        </span>
      )}
    </button>
  )
}

// ── "Como foi resolvido antes" ──────────────────────────────────────────────
// Guia de LEITURA: tarefas concluídas do mesmo trabalho (GET .../semelhantes) +
// atalho p/ a peça de referência daquele caso. NADA é copiado/gerado/concluído —
// só links: abrir a tarefa (deep-link ?task=) e abrir a peça no editor.
interface Semelhante {
  id:            string
  titulo:        string
  concluidaEm:   string | null
  vinculoRotulo: string | null
  pecaId?:       string
  pecaTitulo?:   string
  pecaHref?:     string
}

function HistoricoGuia({
  taskId, onAbrirTarefa,
}: {
  taskId: string
  onAbrirTarefa: (id: string) => void
}) {
  const [itens,  setItens]  = useState<Semelhante[] | null>(null)
  const [aberto, setAberto] = useState(false)

  // Busca best-effort ao abrir/trocar de tarefa. Sem histórico → seção some.
  useEffect(() => {
    let vivo = true
    setItens(null)
    setAberto(false)
    ;(async () => {
      try {
        const res = await fetch(`/api/tasks/${taskId}/semelhantes`)
        if (!vivo) return
        if (res.ok) {
          const d = await res.json().catch(() => null)
          setItens((d?.semelhantes ?? []) as Semelhante[])
        } else {
          setItens([])
        }
      } catch {
        if (vivo) setItens([])
      }
    })()
    return () => { vivo = false }
  }, [taskId])

  if (!itens || itens.length === 0) return null

  return (
    <div className="border-t border-border px-6 py-3">
      <button
        type="button"
        onClick={() => setAberto(v => !v)}
        aria-expanded={aberto}
        className="flex w-full items-center gap-2 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground transition-colors hover:text-foreground"
      >
        {aberto ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
        <BookOpen className="h-3.5 w-3.5" />
        Como foi resolvido antes
        <span className="ml-0.5 flex h-4 min-w-[1rem] items-center justify-center rounded-full bg-muted px-1 text-[10px] font-semibold text-muted-foreground">
          {itens.length}
        </span>
      </button>

      {aberto && (
        <ul className="mt-2 space-y-2">
          {itens.map(s => (
            <li key={s.id} className="rounded-lg border border-border bg-muted/30 px-3 py-2">
              <div className="flex items-start justify-between gap-2">
                <button
                  type="button"
                  onClick={() => onAbrirTarefa(s.id)}
                  title="Abrir esta tarefa"
                  className="group min-w-0 flex-1 text-left"
                >
                  <p className="truncate text-sm font-medium text-foreground transition-colors group-hover:text-primary">
                    {s.titulo}
                  </p>
                  <p className="mt-0.5 flex items-center gap-1.5 truncate text-xs text-muted-foreground">
                    {s.concluidaEm && <span>Concluída em {formatDateBR(s.concluidaEm)}</span>}
                    {s.vinculoRotulo && <span className="truncate">· {s.vinculoRotulo}</span>}
                  </p>
                </button>
                <ExternalLink className="mt-0.5 h-3.5 w-3.5 shrink-0 text-border" />
              </div>
              {s.pecaHref && (
                <a
                  href={s.pecaHref}
                  className="mt-2 inline-flex items-center gap-1.5 rounded-md border border-primary/20 bg-primary/5 px-2.5 py-1 text-xs font-medium text-primary transition-colors hover:bg-primary/10"
                >
                  <FileText className="h-3.5 w-3.5" />
                  Abrir peça de referência{s.pecaTitulo ? ` · ${s.pecaTitulo}` : ''}
                </a>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
