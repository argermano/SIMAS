import { NextRequest, NextResponse } from 'next/server'
import { getAuthContext } from '@/lib/auth'
import { jsonError } from '@/lib/api'
import { z } from 'zod'

const schemaUpdate = z.object({
  description:      z.string().min(1).max(2000).optional(),
  due_date:         z.string().nullable().optional(),
  task_list_id:     z.string().uuid().nullable().optional(),
  process_id:       z.string().uuid().nullable().optional(),
  assignee_id:      z.string().uuid().optional(),
  priority:         z.enum(['baixa', 'media', 'alta', 'urgente']).optional(),
  kanban_board_id:  z.string().uuid().nullable().optional(),
  kanban_column_id: z.string().uuid().nullable().optional(),
  completed_at:     z.string().nullable().optional(),
  extra_assignees:  z.array(z.string().uuid()).optional(),
  tag_ids:          z.array(z.string().uuid()).optional(),
})

// PATCH /api/tasks/[id]
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const auth = await getAuthContext()
  if (!auth.ok) return auth.response
  const { supabase, usuario } = auth

  const body   = await req.json()
  const parsed = schemaUpdate.safeParse(body)
  if (!parsed.success) return jsonError('Dados inválidos', 400)

  const { extra_assignees, tag_ids, ...taskData } = parsed.data

  const { data: task, error } = await supabase
    .from('tasks')
    .update(taskData)
    .eq('id', id)
    .eq('tenant_id', usuario.tenant_id)
    .select()
    .single()

  if (error) return jsonError(error.message, 500)

  // Atualizar responsáveis adicionais (substituição completa)
  if (extra_assignees !== undefined) {
    await supabase.from('task_assignees').delete().eq('task_id', id)
    if (extra_assignees.length > 0) {
      await supabase.from('task_assignees').insert(
        extra_assignees.map(uid => ({ task_id: id, user_id: uid }))
      )
    }
  }

  // Atualizar tags (substituição completa)
  if (tag_ids !== undefined) {
    await supabase.from('task_tag_links').delete().eq('task_id', id)
    if (tag_ids.length > 0) {
      await supabase.from('task_tag_links').insert(
        tag_ids.map(tid => ({ task_id: id, tag_id: tid }))
      )
    }
  }

  return NextResponse.json({ task })
}

// DELETE /api/tasks/[id]
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const auth = await getAuthContext()
  if (!auth.ok) return auth.response
  const { supabase, usuario } = auth

  const { error } = await supabase
    .from('tasks')
    .delete()
    .eq('id', id)
    .eq('tenant_id', usuario.tenant_id)

  if (error) return jsonError(error.message, 500)
  return NextResponse.json({ ok: true })
}
