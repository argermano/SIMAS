'use client'

import { memo, type ComponentType } from 'react'
import { useRouter } from 'next/navigation'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { User, Briefcase, Scale, AlertCircle, FilePen, CalendarPlus, FolderOpen } from 'lucide-react'
import { cn } from '@/lib/utils'
import { resolverVinculoView, type VinculoTipo } from '@/lib/tarefas/vinculo'
import {
  classificarAcaoTarefa, contextoAlvoDaTask, construirHref, ACAO_META, type AcaoConcreta,
} from '@/lib/tarefas/acao'

type RelNome = { id: string; nome: string } | null

export interface TaskData {
  id:                string
  description:       string
  due_date?:         string | null
  priority:          'baixa' | 'media' | 'alta' | 'urgente'
  completed_at?:     string | null
  created_at?:       string | null
  assignee_id?:      string | null
  kanban_column_id?: string | null
  task_list_id?:     string | null
  kanban_board_id?:  string | null
  parent_task_id?:   string | null
  users?:            { id: string; nome: string } | null
  task_tag_links?:   { tag_id: string; task_tags: { id: string; name: string; color: string } | null }[]
  task_assignees?:   { user_id: string; users: { id: string; nome: string } | null }[]
  // Vínculo único (migration 054): process_id=caso, cliente_id=cliente, processo_id=processo
  process_id?:       string | null
  cliente_id?:       string | null
  processo_id?:      string | null
  atendimentos?:     { id: string; area: string; numero_processo?: string | null; clientes?: RelNome } | null
  cliente?:          RelNome
  processo?:         { id: string; numero_cnj: string; apelido: string | null; clientes?: RelNome } | null
  origin_reference?: string | null
}

const VINCULO_ICON: Record<VinculoTipo, typeof User> = {
  cliente:     User,
  atendimento: Briefcase,
  processo:    Scale,
}

// Ícone da ação rápida "Resolver" no card (rótulo no tooltip via ACAO_META).
const ACAO_ICON: Record<AcaoConcreta, ComponentType<{ className?: string }>> = {
  peca:        FilePen,
  agendamento: CalendarPlus,
  documento:   FolderOpen,
  processo:    Scale,
}

const PRIORITY_COLORS: Record<string, string> = {
  baixa:   '#10b981',
  media:   '#3b82f6',
  alta:    '#f59e0b',
  urgente: '#ef4444',
}

// due_date é um DIA (tarefa dia-todo, sem hora — padrão do escritório) guardado
// como meia-noite UTC. Renderizamos e comparamos pelo dia UTC p/ recuperar o dia
// digitado (usar o fuso local exibiria -1 dia no Brasil).
function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('pt-BR', { day: 'numeric', month: 'long', timeZone: 'UTC' })
}

function diaUTC(iso: string): number {
  const d = new Date(iso)
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())
}

function diaDeHoje(): number {
  const n = new Date()
  return Date.UTC(n.getFullYear(), n.getMonth(), n.getDate())
}

/** Estado do vencimento p/ o destaque vermelho (vencida/hoje) do card. */
function estadoVencimento(iso: string): 'vencida' | 'hoje' | 'futura' {
  const due = diaUTC(iso)
  const hoje = diaDeHoje()
  if (due < hoje)  return 'vencida'
  if (due === hoje) return 'hoje'
  return 'futura'
}

function initials(nome: string) {
  return nome.split(' ').map(n => n[0]).slice(0, 2).join('').toUpperCase()
}

interface TaskCardProps {
  task:     TaskData
  onClick?: () => void
}

function TaskCardBase({ task, onClick }: TaskCardProps) {
  const router = useRouter()
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: task.id })

  // Ação rápida "Resolver": classificação PURA no cliente (sem IA/HTTP). O modal
  // faz a versão completa (com desempate por IA); no card, 'indefinido' ou alvo
  // não resolvido simplesmente esconde o atalho. Concluída não mostra.
  const acaoRapida: { acao: AcaoConcreta; href: string; rotulo: string } | null = (() => {
    if (task.completed_at) return null
    const acao = classificarAcaoTarefa(task.description)
    if (acao === 'indefinido') return null
    const href = construirHref(acao, contextoAlvoDaTask(task))
    if (!href) return null
    return { acao, href, rotulo: ACAO_META[acao].rotulo }
  })()

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  }

  const tags       = (task.task_tag_links ?? []).map(l => l.task_tags).filter(Boolean)
  // Borda pela PRIORIDADE (padrão de uso real). As etiquetas coloridas continuam
  // como chips no topo do card — a cor da borda comunica a urgência.
  const borderColor = PRIORITY_COLORS[task.priority] ?? '#6b7280'

  // Responsáveis: principal (1º) + envolvidos. Avatares empilhados como no Astrea.
  const allAssignees = [
    task.users ? { id: task.users.id, nome: task.users.nome } : null,
    ...(task.task_assignees ?? []).map(a => a.users),
  ].filter(Boolean) as { id: string; nome: string }[]

  const visibleAssignees = allAssignees.slice(0, 3)
  const extra            = allAssignees.length - visibleAssignees.length

  const venc = task.due_date ? estadoVencimento(task.due_date) : null
  const vencAlerta = !task.completed_at && (venc === 'vencida' || venc === 'hoje')

  const vinculo    = resolverVinculoView(task)
  const VinculoIcon = vinculo ? VINCULO_ICON[vinculo.tipo] : null

  return (
    <div
      ref={setNodeRef}
      style={{ ...style, borderLeftColor: borderColor }}
      {...attributes}
      {...listeners}
      onClick={onClick}
      className={cn(
        'group relative cursor-pointer rounded-lg bg-card shadow-sm ring-1 ring-border',
        'border-l-4 p-3 transition-shadow hover:shadow-md',
        task.completed_at && 'opacity-60'
      )}
    >
      {/* Ação rápida "Resolver" (ícone no hover). stopPropagation no pointerdown
          evita iniciar o drag; no click evita abrir o modal antes de navegar. */}
      {acaoRapida && (() => {
        const Icone = ACAO_ICON[acaoRapida.acao]
        return (
          <button
            type="button"
            onPointerDown={e => e.stopPropagation()}
            onClick={e => { e.stopPropagation(); router.push(acaoRapida.href) }}
            title={acaoRapida.rotulo}
            aria-label={acaoRapida.rotulo}
            className="absolute right-2 top-2 z-10 rounded-md bg-card/90 p-1.5 text-muted-foreground opacity-0 shadow-sm ring-1 ring-border transition-opacity hover:text-primary focus:opacity-100 group-hover:opacity-100"
          >
            <Icone className="h-3.5 w-3.5" />
          </button>
        )
      })()}

      {/* Tags */}
      {tags.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-1">
          {tags.map(tag => tag && (
            <span
              key={tag.id}
              className="rounded-full px-2 py-0.5 text-xs font-semibold text-white"
              style={{ backgroundColor: tag.color }}
            >
              {tag.name}
            </span>
          ))}
        </div>
      )}

      {/* Selo de subtarefa: card aparece no quadro, mas sinaliza que é filha
          de outra tarefa (o vínculo com a mãe é gerido dentro da tarefa-mãe). */}
      {task.parent_task_id && (
        <span
          title="Esta é uma subtarefa de outra tarefa"
          className="mb-1 inline-flex items-center gap-1 rounded-md bg-muted/70 px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground"
        >
          ↳ Subtarefa
        </span>
      )}

      {/* Descrição */}
      <p className="line-clamp-2 text-sm font-medium text-foreground">
        {task.description}
      </p>

      {/* Selo do vínculo (cliente / caso / processo) */}
      {vinculo && VinculoIcon && (
        <span
          title={vinculo.sublabel ? `${vinculo.label} · ${vinculo.sublabel}` : vinculo.label}
          className={cn(
            'mt-2 inline-flex max-w-full items-center gap-1 rounded-md px-1.5 py-0.5 text-xs',
            vinculo.removido
              ? 'bg-muted text-muted-foreground'
              : 'bg-muted/70 text-muted-foreground',
          )}
        >
          <VinculoIcon className="h-3 w-3 shrink-0" />
          <span className="truncate">{vinculo.label}</span>
        </span>
      )}

      {/* Footer: avatares empilhados (responsável + envolvidos) + data */}
      <div className="mt-3 flex items-center justify-between">
        <div className="flex items-center -space-x-1.5">
          {visibleAssignees.map((u, i) => (
            <span
              key={u.id}
              title={u.nome}
              className={cn(
                'flex h-6 w-6 items-center justify-center rounded-full text-[10px] font-bold text-white ring-2 ring-card',
                i === 0 ? 'bg-primary' : 'bg-primary/70',   // 1º = responsável principal
              )}
            >
              {initials(u.nome)}
            </span>
          ))}
          {extra > 0 && (
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-muted text-[10px] font-bold text-muted-foreground ring-2 ring-card">
              +{extra}
            </span>
          )}
        </div>

        {task.due_date && (
          <span className={cn(
            'inline-flex items-center gap-1 text-xs text-muted-foreground',
            vencAlerta && 'text-destructive font-semibold',
          )}>
            {vencAlerta && <AlertCircle className="h-3 w-3 shrink-0" />}
            {formatDate(task.due_date)}
          </span>
        )}
      </div>
    </div>
  )
}

// Memoizado: evita re-render de todos os cards durante drag/atualizações no Kanban.
export const TaskCard = memo(TaskCardBase)
