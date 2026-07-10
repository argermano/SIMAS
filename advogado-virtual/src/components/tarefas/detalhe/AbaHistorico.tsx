'use client'

import { useEffect, useState } from 'react'
import { Spinner } from '@/components/ui/spinner'
import { formatarDataHora } from '@/lib/utils'
import { History } from 'lucide-react'

interface HistoricoItem {
  id: string
  action: string
  created_at: string
  autor?: { id: string; nome: string | null } | null
  user_nome?: string | null
  metadata?: Record<string, unknown> | null
}

/** Rótulos amigáveis das ações de auditoria da tarefa (fallback = a própria ação). */
const ACTION_LABELS: Record<string, string> = {
  'task.create':      'Tarefa criada',
  'task.created':     'Tarefa criada',
  'task.update':      'Tarefa atualizada',
  'task.updated':     'Tarefa atualizada',
  'task.complete':    'Tarefa concluída',
  'task.completed':   'Tarefa concluída',
  'task.reopen':      'Tarefa reaberta',
  'task.reopened':    'Tarefa reaberta',
  'task.delete':      'Tarefa excluída',
  'task.deleted':     'Tarefa excluída',
  'task.move':        'Movida de quadro/coluna',
  'task.moved':       'Movida de quadro/coluna',
  'task.assign':      'Responsável alterado',
}

/** Rótulos dos campos que podem aparecer em metadata.changed / metadata.campos. */
const FIELD_LABELS: Record<string, string> = {
  description:      'Descrição',
  due_date:         'Vencimento',
  priority:         'Prioridade',
  assignee_id:      'Responsável',
  kanban_board_id:  'Quadro',
  kanban_column_id: 'Coluna',
  task_list_id:     'Lista',
  tag_ids:          'Etiquetas',
  completed_at:     'Conclusão',
}

function rotuloAcao(action: string): string {
  return ACTION_LABELS[action] ?? action
}

function autorDe(item: HistoricoItem): string | null {
  return item.autor?.nome ?? item.user_nome ?? null
}

/** Extrai a lista de campos alterados de metadata (aceita changed[] ou campos[] ou chaves de before/after). */
function camposAlterados(meta: Record<string, unknown> | null | undefined): string[] {
  if (!meta) return []
  const raw =
    (Array.isArray(meta.changed) && meta.changed) ||
    (Array.isArray(meta.campos) && meta.campos) ||
    (Array.isArray(meta.fields) && meta.fields) ||
    null
  if (raw) return (raw as unknown[]).map(String).map(f => FIELD_LABELS[f] ?? f)
  const before = meta.before && typeof meta.before === 'object' ? meta.before : null
  const after = meta.after && typeof meta.after === 'object' ? meta.after : null
  if (before && after) {
    return Object.keys(after as Record<string, unknown>).map(f => FIELD_LABELS[f] ?? f)
  }
  return []
}

/**
 * Aba "Histórico de alterações" do modal de tarefa. Lê a trilha de auditoria
 * filtrada a esta tarefa em GET /api/tasks/[id]/historico. Somente leitura.
 */
export function AbaHistorico({ taskId }: { taskId: string }) {
  const [itens, setItens] = useState<HistoricoItem[] | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let vivo = true
    setLoading(true)
    ;(async () => {
      try {
        const res = await fetch(`/api/tasks/${taskId}/historico`)
        if (!vivo) return
        if (res.ok) {
          const d = await res.json().catch(() => ({}))
          const lista = (d.historico ?? d.eventos ?? (Array.isArray(d) ? d : [])) as HistoricoItem[]
          setItens(lista)
        } else {
          setItens([])
        }
      } catch {
        if (vivo) setItens([])
      } finally {
        if (vivo) setLoading(false)
      }
    })()
    return () => { vivo = false }
  }, [taskId])

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
        <Spinner className="h-4 w-4" /> Carregando histórico…
      </div>
    )
  }

  if (!itens || itens.length === 0) {
    return (
      <div className="flex flex-col items-center gap-1.5 py-6 text-center text-sm text-muted-foreground">
        <History className="h-5 w-5 opacity-60" />
        Sem alterações registradas.
      </div>
    )
  }

  return (
    <ol className="space-y-0">
      {itens.map((item, i) => {
        const campos = camposAlterados(item.metadata)
        const autor = autorDe(item)
        return (
          <li key={item.id} className="relative flex gap-3 pb-4 last:pb-0">
            {/* Trilha vertical */}
            <div className="flex flex-col items-center">
              <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-primary" />
              {i < itens.length - 1 && <span className="w-px flex-1 bg-border" />}
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-foreground">{rotuloAcao(item.action)}</p>
              {campos.length > 0 && (
                <p className="text-xs text-muted-foreground">{campos.join(', ')}</p>
              )}
              <p className="mt-0.5 text-xs text-muted-foreground">
                {formatarDataHora(item.created_at)}
                {autor ? ` · ${autor}` : ''}
              </p>
            </div>
          </li>
        )
      })}
    </ol>
  )
}
