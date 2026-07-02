import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getAuthContext } from '@/lib/auth'
import { jsonError, validateBody } from '@/lib/api'
import { pertenceAoTenant } from '@/lib/ownership'

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
  const auth = await getAuthContext()
  if (!auth.ok) return auth.response
  const { supabase, usuario } = auth

  const { searchParams } = new URL(req.url)
  const board_id   = searchParams.get('board_id')
  const column_id  = searchParams.get('column_id')
  const assignee   = searchParams.get('assignee') // 'me' ou uuid
  const period     = searchParams.get('period')    // 'month', 'week', 'today'
  const tag_id     = searchParams.get('tag_id')
  const search     = searchParams.get('search')

  // Paginação configurável (retrocompatível: default = limit 100, página 1).
  const limitParam = Number(searchParams.get('limit'))
  const limit = Number.isFinite(limitParam) && limitParam > 0
    ? Math.min(Math.floor(limitParam), 1000)
    : 100
  const pageParam = Number(searchParams.get('page'))
  const page = Number.isFinite(pageParam) && pageParam > 0 ? Math.floor(pageParam) : 1
  const offset = (page - 1) * limit

  let query = supabase
    .from('tasks')
    .select(`
      id, description, due_date, priority, origin, completed_at, created_at, updated_at,
      task_list_id, process_id, assignee_id, kanban_board_id, kanban_column_id, origin_reference,
      task_lists(name),
      atendimentos(id, area),
      users!tasks_assignee_id_fkey(id, nome),
      task_tag_links(tag_id, task_tags(id, name, color)),
      task_assignees(user_id, users(id, nome))
    `, { count: 'exact' })
    .eq('tenant_id', usuario.tenant_id)
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1)

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
  if (error) return jsonError(error.message, 500)

  // Filtrar por tag (pós-query pois é relação many-to-many)
  let tasks = data ?? []
  if (tag_id) {
    tasks = tasks.filter((t: {task_tag_links: {tag_id: string}[]}) =>
      t.task_tag_links?.some((l: {tag_id: string}) => l.tag_id === tag_id)
    )
  }

  return NextResponse.json({ tasks, total: count ?? tasks.length, page, limit })
}

// POST /api/tasks
export async function POST(req: NextRequest) {
  const auth = await getAuthContext()
  if (!auth.ok) return auth.response
  const { supabase, usuario } = auth

  const parsed = await validateBody(req, schemaCreate)
  if (!parsed.ok) return parsed.response

  const { extra_assignees, tag_ids, ...taskData } = parsed.data

  // A8: os responsáveis (assignee + extras) precisam ser usuários do tenant —
  // impede vincular tarefa a usuário de outro tenant (link cruzado / sondagem de IDs).
  const responsaveis = [taskData.assignee_id, ...(extra_assignees ?? [])]
  for (const uid of responsaveis) {
    if (!(await pertenceAoTenant(supabase, 'users', uid, usuario.tenant_id))) {
      return jsonError('Responsável inválido', 400)
    }
  }

  const { data: task, error } = await supabase
    .from('tasks')
    .insert({
      ...taskData,
      tenant_id:  usuario.tenant_id,
      created_by: usuario.id,
    })
    .select()
    .single()

  if (error) return jsonError(error.message, 500)

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
