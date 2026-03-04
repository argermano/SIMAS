import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { z } from 'zod'

const schemaCreate = z.object({
  description:      z.string().min(1).max(2000),
  due_date:         z.string().optional().nullable(),
  task_list_id:     z.string().uuid().optional().nullable(),
  process_id:       z.string().uuid().optional().nullable(),
  assignee_id:      z.string().uuid(),
  priority:         z.enum(['baixa', 'media', 'alta', 'urgente']).default('media'),
  kanban_board_id:  z.string().uuid().optional().nullable(),
  kanban_column_id: z.string().uuid().optional().nullable(),
  extra_assignees:  z.array(z.string().uuid()).optional(),
  tag_ids:          z.array(z.string().uuid()).optional(),
  origin:           z.enum(['manual', 'automatic']).default('manual'),
  origin_reference: z.string().optional().nullable(),
})

// GET /api/tasks
export async function GET(req: NextRequest) {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })

  const { data: usuario } = await supabase
    .from('users').select('id, tenant_id').eq('auth_user_id', user.id).single()
  if (!usuario) return NextResponse.json({ error: 'Não encontrado' }, { status: 404 })

  const { searchParams } = new URL(req.url)
  const board_id   = searchParams.get('board_id')
  const column_id  = searchParams.get('column_id')
  const assignee   = searchParams.get('assignee') // 'me' ou uuid
  const period     = searchParams.get('period')    // 'month', 'week', 'today'
  const tag_id     = searchParams.get('tag_id')
  const search     = searchParams.get('search')

  let query = supabase
    .from('tasks')
    .select(`
      id, description, due_date, priority, origin, completed_at, created_at, updated_at,
      task_list_id, process_id, assignee_id, kanban_board_id, kanban_column_id,
      task_lists(name),
      atendimentos(id, area),
      users!tasks_assignee_id_fkey(id, nome),
      task_tag_links(tag_id, task_tags(id, name, color)),
      task_assignees(user_id, users(id, nome))
    `, { count: 'exact' })
    .eq('tenant_id', usuario.tenant_id)
    .order('created_at', { ascending: false })
    .limit(100)

  if (board_id)  query = query.eq('kanban_board_id', board_id)
  if (column_id) query = query.eq('kanban_column_id', column_id)

  if (assignee === 'me') {
    query = query.eq('assignee_id', usuario.id)
  } else if (assignee && assignee !== 'all') {
    query = query.eq('assignee_id', assignee)
  }

  if (period) {
    const now   = new Date()
    let start: Date | null = null
    let end:   Date | null = null
    if (period === 'today') {
      start = new Date(now.getFullYear(), now.getMonth(), now.getDate())
      end   = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1)
    } else if (period === 'week') {
      const day = now.getDay()
      start = new Date(now); start.setDate(now.getDate() - day)
      end   = new Date(now); end.setDate(now.getDate() + (6 - day) + 1)
    } else if (period === 'month') {
      start = new Date(now.getFullYear(), now.getMonth(), 1)
      end   = new Date(now.getFullYear(), now.getMonth() + 1, 1)
    }
    if (start) query = query.gte('due_date', start.toISOString())
    if (end)   query = query.lt('due_date', end.toISOString())
  }

  if (search) query = query.ilike('description', `%${search}%`)

  const { data, error, count } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Filtrar por tag (pós-query pois é relação many-to-many)
  let tasks = data ?? []
  if (tag_id) {
    tasks = tasks.filter((t: {task_tag_links: {tag_id: string}[]}) =>
      t.task_tag_links?.some((l: {tag_id: string}) => l.tag_id === tag_id)
    )
  }

  return NextResponse.json({ tasks, total: count ?? tasks.length })
}

// POST /api/tasks
export async function POST(req: NextRequest) {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })

  const { data: usuario } = await supabase
    .from('users').select('id, tenant_id').eq('auth_user_id', user.id).single()
  if (!usuario) return NextResponse.json({ error: 'Não encontrado' }, { status: 404 })

  const body   = await req.json()
  const parsed = schemaCreate.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: 'Dados inválidos', details: parsed.error.flatten() }, { status: 400 })

  const { extra_assignees, tag_ids, ...taskData } = parsed.data

  const { data: task, error } = await supabase
    .from('tasks')
    .insert({
      ...taskData,
      tenant_id:  usuario.tenant_id,
      created_by: usuario.id,
    })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Responsáveis adicionais
  if (extra_assignees && extra_assignees.length > 0) {
    await supabase.from('task_assignees').insert(
      extra_assignees.map(uid => ({ task_id: task.id, user_id: uid }))
    )
  }

  // Tags
  if (tag_ids && tag_ids.length > 0) {
    await supabase.from('task_tag_links').insert(
      tag_ids.map(tid => ({ task_id: task.id, tag_id: tid }))
    )
  }

  return NextResponse.json({ task }, { status: 201 })
}
