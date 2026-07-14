import { NextRequest, NextResponse } from 'next/server'
import { getAuthContext } from '@/lib/auth'
import { jsonError } from '@/lib/api'

/**
 * Histórico de alterações de uma tarefa (aba "Histórico" do modal).
 * Lê `audit_log` filtrado a resource_type='task' + resource_id=<id>, escopo tenant,
 * e devolve um shape amigável (quem / quando / o quê) — como no Astrea
 * ("criada", "adicionada ao quadro", "descrição alterada", "concluída"…).
 *
 * As mutações de tarefa (POST/PATCH/DELETE em /api/tasks/**) gravam esses eventos
 * via logAudit; aqui só traduzimos para texto legível.
 */

// ─── Rótulos de campo (pt-BR) para os diffs de PATCH ────────────────────────
const ROTULO_CAMPO: Record<string, string> = {
  description: 'descrição',
  due_date: 'data de vencimento',
  priority: 'prioridade',
  task_list_id: 'lista',
  process_id: 'caso vinculado',
  cliente_id: 'cliente vinculado',
  processo_id: 'processo vinculado',
  assignee_id: 'responsável',
  kanban_board_id: 'quadro',
  kanban_column_id: 'coluna',
  completed_at: 'conclusão',
  extra_assignees: 'envolvidos',
  tag_ids: 'tags',
}

interface Mudanca {
  field: string
  de?: unknown
  para?: unknown
}

interface AuditRow {
  id: string
  action: string
  created_at: string
  user_id: string | null
  metadata: Record<string, unknown> | null
  users: { id: string; nome: string | null } | { id: string; nome: string | null }[] | null
}

function normalizarQuem(row: AuditRow): { id: string; nome: string | null } | null {
  const u = Array.isArray(row.users) ? row.users[0] : row.users
  if (u) return { id: u.id, nome: u.nome }
  return row.user_id ? { id: row.user_id, nome: null } : null
}

function rotuloCampo(field: string): string {
  return ROTULO_CAMPO[field] ?? field
}

/** Frase legível para cada evento do histórico. */
function descreverEvento(row: AuditRow): string {
  const md = row.metadata ?? {}

  switch (row.action) {
    case 'task.create':
      return 'Tarefa criada'
    case 'task.delete':
      return 'Tarefa excluída'
    case 'task.update': {
      const mudancas = Array.isArray(md.changes) ? (md.changes as Mudanca[]) : []
      // Conclusão / reabertura têm frase própria.
      const conclusao = mudancas.find((m) => m.field === 'completed_at')
      if (conclusao) {
        if (conclusao.para) return 'Tarefa concluída'
        return 'Tarefa reaberta'
      }
      if (mudancas.length === 0) return 'Tarefa atualizada'
      const campos = mudancas.map((m) => rotuloCampo(m.field))
      // Ex.: "descrição alterada" / "prioridade, quadro alterados"
      if (campos.length === 1) return `Alterou a ${campos[0]}`
      return `Alterou ${campos.join(', ')}`
    }
    default:
      return row.action
  }
}

// GET /api/tasks/[id]/historico → { historico: [...] } (mais recente primeiro)
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const auth = await getAuthContext()
  if (!auth.ok) return auth.response
  const { supabase, usuario } = auth

  // Escopo defensivo: a tarefa precisa ser do tenant do usuário.
  const { data: tarefa } = await supabase
    .from('tasks')
    .select('id')
    .eq('id', id)
    .eq('tenant_id', usuario.tenant_id)
    .maybeSingle()

  if (!tarefa) return jsonError('Tarefa não encontrada', 404)

  const { data, error } = await supabase
    .from('audit_log')
    .select('id, action, created_at, user_id, metadata, users(id, nome)')
    .eq('tenant_id', usuario.tenant_id)
    .eq('resource_type', 'task')
    .eq('resource_id', id)
    .order('created_at', { ascending: false })

  if (error) return jsonError(error.message, 500)

  const historico = ((data ?? []) as AuditRow[]).map((row) => ({
    id: row.id,
    quando: row.created_at,
    quem: normalizarQuem(row),
    acao: row.action,
    descricao: descreverEvento(row),
    detalhes: row.metadata ?? {},
  }))

  return NextResponse.json({ historico })
}
