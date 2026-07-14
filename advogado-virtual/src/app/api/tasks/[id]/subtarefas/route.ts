import { NextRequest, NextResponse } from 'next/server'
import { getAuthContext } from '@/lib/auth'
import { jsonError } from '@/lib/api'

/**
 * Subtarefas (tarefas-filha) de uma tarefa — aba/lista dentro da mãe.
 * Uma subtarefa é uma tarefa COMPLETA (responsável, prazo, kanban) ligada pela
 * coluna tasks.parent_task_id (migração 055).
 *
 * Aqui só LISTAMOS as filhas. Criar subtarefa reusa POST /api/tasks com
 * { parent_task_id: <id> } — não há POST próprio para não duplicar a lógica.
 */

interface FilhaRow {
  id: string
  description: string
  due_date: string | null
  priority: string
  completed_at: string | null
  kanban_column_id: string | null
  users: { id: string; nome: string | null } | { id: string; nome: string | null }[] | null
  kanban_columns: { id: string; name: string } | { id: string; name: string }[] | null
}

function um<T>(v: T | T[] | null): T | null {
  return Array.isArray(v) ? (v[0] ?? null) : v
}

// GET /api/tasks/[id]/subtarefas → { subtarefas: [...] }
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const auth = await getAuthContext()
  if (!auth.ok) return auth.response
  const { supabase, usuario } = auth

  // A mãe precisa existir e ser do tenant (RLS ativa; se não vê, 404).
  const { data: mae } = await supabase
    .from('tasks')
    .select('id')
    .eq('id', id)
    .eq('tenant_id', usuario.tenant_id)
    .maybeSingle()
  if (!mae) return jsonError('Tarefa não encontrada', 404)

  const { data, error } = await supabase
    .from('tasks')
    .select(`
      id, description, due_date, priority, completed_at, kanban_column_id,
      users!tasks_assignee_id_fkey(id, nome),
      kanban_columns(id, name)
    `)
    .eq('parent_task_id', id)
    .eq('tenant_id', usuario.tenant_id)
    .order('created_at', { ascending: true })

  if (error) return jsonError(error.message, 500)

  const subtarefas = ((data ?? []) as FilhaRow[]).map((row) => ({
    id: row.id,
    description: row.description,
    due_date: row.due_date,
    priority: row.priority,
    completed_at: row.completed_at,          // null = aberta; preenchido = concluída
    kanban_column_id: row.kanban_column_id,
    coluna: um(row.kanban_columns),          // { id, name } da coluna do board
    assignee: um(row.users),                 // { id, nome } do responsável principal
  }))

  return NextResponse.json({ subtarefas })
}
