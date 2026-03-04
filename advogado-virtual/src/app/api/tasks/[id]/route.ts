import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
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

async function getUsuario(supabase: Awaited<ReturnType<typeof createClient>>) {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const { data } = await supabase
    .from('users').select('id, tenant_id').eq('auth_user_id', user.id).single()
  return data
}

// PATCH /api/tasks/[id]
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  const usuario  = await getUsuario(supabase)
  if (!usuario) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })

  const body   = await req.json()
  const parsed = schemaUpdate.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: 'Dados inválidos' }, { status: 400 })

  const { extra_assignees, tag_ids, ...taskData } = parsed.data

  const { data: task, error } = await supabase
    .from('tasks')
    .update(taskData)
    .eq('id', id)
    .eq('tenant_id', usuario.tenant_id)
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

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
  const supabase = await createClient()
  const usuario  = await getUsuario(supabase)
  if (!usuario) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })

  const { error } = await supabase
    .from('tasks')
    .delete()
    .eq('id', id)
    .eq('tenant_id', usuario.tenant_id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
