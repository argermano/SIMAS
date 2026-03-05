import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

// GET /api/tasks/due-today — retorna tarefas do usuário que vencem hoje e não estão concluídas
export async function GET() {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ tasks: [] })

  const { data: usuario } = await supabase
    .from('users')
    .select('id, tenant_id')
    .eq('auth_user_id', user.id)
    .single()

  if (!usuario) return NextResponse.json({ tasks: [] })

  const today = new Date()
  const startOfDay = new Date(today.getFullYear(), today.getMonth(), today.getDate()).toISOString()
  const endOfDay = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 23, 59, 59).toISOString()

  // Buscar tarefas com due_date hoje, não concluídas, atribuídas ao usuário
  const { data: tasks } = await supabase
    .from('tasks')
    .select('id, description, due_date, priority, completed_at')
    .eq('tenant_id', usuario.tenant_id)
    .eq('assignee_id', usuario.id)
    .is('completed_at', null)
    .gte('due_date', startOfDay)
    .lte('due_date', endOfDay)
    .order('due_date', { ascending: true })
    .limit(20)

  // Também buscar tarefas atrasadas (due_date < hoje e não concluídas)
  const { data: overdue } = await supabase
    .from('tasks')
    .select('id, description, due_date, priority, completed_at')
    .eq('tenant_id', usuario.tenant_id)
    .eq('assignee_id', usuario.id)
    .is('completed_at', null)
    .lt('due_date', startOfDay)
    .order('due_date', { ascending: true })
    .limit(20)

  return NextResponse.json({
    today: tasks ?? [],
    overdue: overdue ?? [],
  })
}
