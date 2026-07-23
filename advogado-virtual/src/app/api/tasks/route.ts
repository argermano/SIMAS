import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getAuthContext } from '@/lib/auth'
import { jsonError, validateBody } from '@/lib/api'
import { pertenceAoTenant } from '@/lib/ownership'
import { logAudit } from '@/lib/audit'
import { vinculoParaColunas } from '@/lib/tarefas/vinculo'
import { vinculoValido } from '@/lib/tarefas/validar-vinculo'
import { calendarAdmin, agendarEspelhoUsuarios, coletarAfetadosTask } from '@/lib/calendar/fila'

// Vínculo único (cliente | caso | processo) — ver migration 054 e lib/tarefas/vinculo.
const schemaVinculo = z
  .object({ tipo: z.enum(['cliente', 'atendimento', 'processo']), id: z.string().uuid() })
  .nullable()

const schemaCreate = z.object({
  description:      z.string().min(1).max(2000),
  due_date:         z.string().optional().nullable(),
  task_list_id:     z.string().uuid().optional().nullable(),
  process_id:       z.string().uuid().optional().nullable(),
  vinculo:          schemaVinculo.optional(),
  assignee_id:      z.string().uuid(),
  parent_task_id:   z.string().uuid().optional().nullable(), // subtarefa: id da tarefa-mãe
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
  const month      = searchParams.get('month')     // 'YYYY-MM' (navegador de mês do quadro)
  const tag_id     = searchParams.get('tag_id')
  const search     = searchParams.get('search')
  const parent     = searchParams.get('parent') // uuid da mãe | 'all' p/ incluir filhas

  // Paginação configurável (retrocompatível: default = limit 100, página 1).
  // Mantemos o teto em 100: o SELECT abaixo traz 7 relações aninhadas por linha
  // (embed caro, incl. processo→processos→clientes em 3 níveis), então subir o
  // default multiplicaria o custo do join. Acima do teto respondemos com
  // `truncado` p/ o consumidor avisar em vez de esconder linhas em silêncio.
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
      task_list_id, process_id, cliente_id, processo_id, assignee_id, kanban_board_id, kanban_column_id, origin_reference, parent_task_id,
      task_lists(name),
      atendimentos(id, area, numero_processo, clientes(id, nome)),
      cliente:clientes!cliente_id(id, nome),
      processo:processos!processo_id(id, numero_cnj, apelido, clientes(id, nome)),
      users!tasks_assignee_id_fkey(id, nome),
      task_tag_links(tag_id, task_tags(id, name, color)),
      task_assignees(user_id, users(id, nome))
    `, { count: 'exact' })
    .eq('tenant_id', usuario.tenant_id)
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1)

  if (board_id)  query = query.eq('kanban_board_id', board_id)
  if (column_id) query = query.eq('kanban_column_id', column_id)

  // Subtarefas: por padrão o board mostra só tarefas-raiz (sem mãe) — as filhas
  // aparecem dentro da mãe (via /api/tasks/[id]/subtarefas). ?parent=<id> lista
  // as filhas de uma mãe; ?parent=all inclui tudo (raiz + filhas).
  if (parent && parent !== 'all') {
    query = query.eq('parent_task_id', parent)
  } else if (!parent) {
    query = query.is('parent_task_id', null)
  }

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

  // Navegador de mês do quadro (Astrea: "< JULHO 2026 >"): filtra pelo vencimento
  // dentro do mês pedido. Fronteiras em horário local (paridade com o bloco period
  // acima). Tarefas sem due_date ficam de fora do recorte de mês — por isso a UI
  // oferece "Todos os períodos" p/ vê-las (nunca some card em silêncio).
  if (month && /^\d{4}-\d{2}$/.test(month)) {
    const [ano, mes] = month.split('-').map(Number)
    const start = new Date(ano, mes - 1, 1)
    const end   = new Date(ano, mes, 1)
    query = query.gte('due_date', start.toISOString()).lt('due_date', end.toISOString())
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

  // Truncamento: existem linhas além desta página no banco. `count` é o total
  // antes do filtro de tag (que é pós-query), então o aviso pode aparecer mesmo
  // com tag ativa — coerente, pois a filtragem por tag também só enxerga a página.
  const total = count ?? tasks.length
  const truncado = (count ?? 0) > offset + limit

  return NextResponse.json({ tasks, total, truncado, page, limit })
}

// POST /api/tasks
export async function POST(req: NextRequest) {
  const auth = await getAuthContext()
  if (!auth.ok) return auth.response
  const { supabase, usuario } = auth

  const parsed = await validateBody(req, schemaCreate)
  if (!parsed.ok) return parsed.response

  const { extra_assignees, tag_ids, vinculo, ...taskData } = parsed.data

  // Dedup + remove o principal dos extras (ele já vai em tasks.assignee_id):
  // duplicar mostraria o mesmo responsável 2x no card e inflaria o "+N".
  const extrasLimpos = [...new Set(extra_assignees ?? [])].filter(uid => uid !== taskData.assignee_id)

  // A8: os responsáveis (assignee + extras) precisam ser usuários do tenant —
  // impede vincular tarefa a usuário de outro tenant (link cruzado / sondagem de IDs).
  const responsaveis = [taskData.assignee_id, ...extrasLimpos]
  for (const uid of responsaveis) {
    if (!(await pertenceAoTenant(supabase, 'users', uid, usuario.tenant_id))) {
      return jsonError('Responsável inválido', 400)
    }
  }

  // Subtarefa: a tarefa-mãe precisa ser do mesmo tenant (impede vincular filha a
  // tarefa de outro escritório / sondar IDs — a FK só exige que a mãe exista).
  if (taskData.parent_task_id) {
    const { data: mae } = await supabase
      .from('tasks')
      .select('id, parent_task_id')
      .eq('id', taskData.parent_task_id)
      .eq('tenant_id', usuario.tenant_id)
      .maybeSingle()
    if (!mae) return jsonError('Tarefa-mãe inválida', 400)
    // Só 1 nível: a mãe tem de ser uma tarefa-raiz. Uma "neta" ficaria invisível
    // (fora do board e da aba de subtarefas da avó, que só lista filhas diretas).
    if (mae.parent_task_id) return jsonError('Não é possível criar subtarefa de uma subtarefa', 400)
  }

  // Vínculo único (cliente/caso/processo): valida propriedade e mapeia p/ as 3 colunas.
  let colunasVinculo: ReturnType<typeof vinculoParaColunas> | null = null
  if (vinculo !== undefined) {
    if (vinculo && !(await vinculoValido(supabase, vinculo, usuario.tenant_id))) {
      return jsonError('Vínculo inválido', 400)
    }
    colunasVinculo = vinculoParaColunas(vinculo)
  }

  const { data: task, error } = await supabase
    .from('tasks')
    .insert({
      ...taskData,
      ...(colunasVinculo ?? {}), // sobrepõe process_id p/ garantir exclusividade
      tenant_id:  usuario.tenant_id,
      created_by: usuario.id,
    })
    .select()
    .single()

  if (error) return jsonError(error.message, 500)

  // Responsáveis adicionais (já validados e sem o principal)
  if (extrasLimpos.length > 0) {
    await supabase.from('task_assignees').insert(
      extrasLimpos.map(uid => ({ task_id: task.id, user_id: uid }))
    )
  }

  // Tags
  if (tag_ids && tag_ids.length > 0) {
    await supabase.from('task_tag_links').insert(
      tag_ids.map(tid => ({ task_id: task.id, tag_id: tid }))
    )
  }

  // Trilha de auditoria → alimenta o histórico do modal de tarefa.
  await logAudit({
    tenantId: usuario.tenant_id,
    userId: usuario.id,
    action: 'task.create',
    resourceType: 'task',
    resourceId: task.id,
    metadata: {
      description: taskData.description,
      priority: taskData.priority,
      due_date: taskData.due_date ?? null,
      kanban_board_id: taskData.kanban_board_id ?? null,
      origin: taskData.origin,
      origin_reference: taskData.origin_reference ?? null,
    },
  })

  // Espelho ativo no Google Calendar: enfileira responsável+extras+criador e
  // dispara o dreno pós-resposta (a tarefa com due_date vira all-day no espelho).
  // No-op se o espelho está inerte.
  const calAdmin = calendarAdmin()
  await agendarEspelhoUsuarios(calAdmin, usuario.tenant_id, await coletarAfetadosTask(calAdmin, task.id))

  return NextResponse.json({ task }, { status: 201 })
}
