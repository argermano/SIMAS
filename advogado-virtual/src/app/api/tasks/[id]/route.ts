import { NextRequest, NextResponse } from 'next/server'
import { getAuthContext } from '@/lib/auth'
import { jsonError } from '@/lib/api'
import { logAudit } from '@/lib/audit'
import { pertenceAoTenant } from '@/lib/ownership'
import { z } from 'zod'
import { vinculoParaColunas } from '@/lib/tarefas/vinculo'
import { vinculoValido } from '@/lib/tarefas/validar-vinculo'
import { calendarAdmin, agendarEspelhoUsuarios, coletarAfetadosTask } from '@/lib/calendar/fila'

const schemaVinculo = z
  .object({ tipo: z.enum(['cliente', 'atendimento', 'processo']), id: z.string().uuid() })
  .nullable()

const schemaUpdate = z.object({
  description:      z.string().min(1).max(2000).optional(),
  due_date:         z.string().nullable().optional(),
  task_list_id:     z.string().uuid().nullable().optional(),
  process_id:       z.string().uuid().nullable().optional(),
  vinculo:          schemaVinculo.optional(),
  assignee_id:      z.string().uuid().optional(),
  priority:         z.enum(['baixa', 'media', 'alta', 'urgente']).optional(),
  kanban_board_id:  z.string().uuid().nullable().optional(),
  kanban_column_id: z.string().uuid().nullable().optional(),
  completed_at:     z.string().nullable().optional(),
  extra_assignees:  z.array(z.string().uuid()).optional(),
  tag_ids:          z.array(z.string().uuid()).optional(),
})

// Mesmo embed do GET /api/tasks (lista): o modal de detalhe precisa das relações
// (responsáveis, tags, vínculo) para renderizar igual ao card. Usado no deep-link
// (/tarefas?task=<id>) quando a tarefa não está na página carregada do quadro.
const SELECT_TASK = `
  id, description, due_date, priority, origin, completed_at, created_at, updated_at,
  task_list_id, process_id, cliente_id, processo_id, assignee_id, kanban_board_id, kanban_column_id, origin_reference, parent_task_id,
  task_lists(name),
  atendimentos(id, area, numero_processo, clientes(id, nome)),
  cliente:clientes!cliente_id(id, nome),
  processo:processos!processo_id(id, numero_cnj, apelido, clientes(id, nome)),
  users!tasks_assignee_id_fkey(id, nome),
  task_tag_links(tag_id, task_tags(id, name, color)),
  task_assignees(user_id, users(id, nome))
`

// GET /api/tasks/[id] → uma tarefa com o embed completo (deep-link do modal).
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const auth = await getAuthContext()
  if (!auth.ok) return auth.response
  const { supabase, usuario } = auth

  const { data: task, error } = await supabase
    .from('tasks')
    .select(SELECT_TASK)
    .eq('id', id)
    .eq('tenant_id', usuario.tenant_id)
    .maybeSingle()

  if (error) return jsonError(error.message, 500)
  if (!task) return jsonError('Tarefa não encontrada', 404)
  return NextResponse.json({ task })
}

// PATCH /api/tasks/[id]
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const auth = await getAuthContext()
  if (!auth.ok) return auth.response
  const { supabase, usuario } = auth

  const body   = await req.json()
  const parsed = schemaUpdate.safeParse(body)
  if (!parsed.success) return jsonError('Dados inválidos', 400)

  const { extra_assignees, tag_ids, vinculo, ...rest } = parsed.data
  const taskData: Record<string, unknown> = { ...rest }

  // Vínculo único (cliente/caso/processo): valida propriedade e mapeia p/ as 3
  // colunas (a escolhida recebe o id, as outras vão a null → mantém exclusividade).
  if (vinculo !== undefined) {
    if (vinculo && !(await vinculoValido(supabase, vinculo, usuario.tenant_id))) {
      return jsonError('Vínculo inválido', 400)
    }
    Object.assign(taskData, vinculoParaColunas(vinculo))
  }

  // Fronteira de tenant (paridade com o POST): cada responsável extra tem de ser
  // usuário do MESMO escritório. A RLS de task_assignees só confere o task_id
  // (não o user_id) — sem isto dava p/ gravar responsável de outro tenant / sondar UUIDs.
  let extrasUnicos: string[] | undefined
  if (extra_assignees !== undefined) {
    extrasUnicos = [...new Set(extra_assignees)]
    for (const uid of extrasUnicos) {
      if (!(await pertenceAoTenant(supabase, 'users', uid, usuario.tenant_id))) {
        return jsonError('Responsável inválido', 400)
      }
    }
  }

  // Espelho: quem estava na tarefa ANTES (reatribuir/limpar due_date pode remover
  // usuários que precisam ser reconciliados). Capturado antes da mutação.
  const calAdmin = calendarAdmin()
  const afetadosAntes = await coletarAfetadosTask(calAdmin, id)

  // Estado anterior (para o diff do histórico). Não altera o comportamento:
  // se a tarefa não existir/for de outro tenant, o update abaixo falha como antes.
  const camposEscalares = Object.keys(taskData)
  const { data: anterior } = camposEscalares.length
    ? await supabase
        .from('tasks')
        .select(
          'description, due_date, task_list_id, process_id, cliente_id, processo_id, assignee_id, priority, kanban_board_id, kanban_column_id, completed_at',
        )
        .eq('id', id)
        .eq('tenant_id', usuario.tenant_id)
        .maybeSingle()
    : { data: null }

  const { data: task, error } = await supabase
    .from('tasks')
    .update(taskData)
    .eq('id', id)
    .eq('tenant_id', usuario.tenant_id)
    .select()
    .single()

  if (error) return jsonError(error.message, 500)

  // Atualizar responsáveis adicionais (substituição completa)
  if (extrasUnicos !== undefined) {
    // Remove o principal dos extras (não duplica o responsável no card). Principal
    // efetivo = o enviado no PATCH ou, se não veio, o já gravado (anterior).
    const principal =
      rest.assignee_id ?? (anterior as { assignee_id?: string | null } | null)?.assignee_id ?? undefined
    const paraInserir = extrasUnicos.filter(uid => uid !== principal)
    await supabase.from('task_assignees').delete().eq('task_id', id)
    if (paraInserir.length > 0) {
      await supabase.from('task_assignees').insert(
        paraInserir.map(uid => ({ task_id: id, user_id: uid }))
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

  // Trilha de auditoria → alimenta o histórico do modal. Só registra o que mudou.
  const changes: { field: string; de?: unknown; para?: unknown }[] = []
  const anteriorRec = (anterior ?? {}) as Record<string, unknown>
  for (const campo of camposEscalares) {
    const de = anteriorRec[campo as string]
    const para = taskData[campo]
    if ((de ?? null) !== (para ?? null)) changes.push({ field: campo as string, de: de ?? null, para: para ?? null })
  }
  if (extra_assignees !== undefined) changes.push({ field: 'extra_assignees', para: extra_assignees })
  if (tag_ids !== undefined) changes.push({ field: 'tag_ids', para: tag_ids })

  if (changes.length > 0) {
    await logAudit({
      tenantId: usuario.tenant_id,
      userId: usuario.id,
      action: 'task.update',
      resourceType: 'task',
      resourceId: id,
      metadata: { changes },
    })
  }

  // Espelho: união dos afetados ANTES e DEPOIS (novos responsáveis + os removidos).
  await agendarEspelhoUsuarios(calAdmin, usuario.tenant_id, [
    ...afetadosAntes,
    ...(await coletarAfetadosTask(calAdmin, id)),
  ])

  return NextResponse.json({ task })
}

// DELETE /api/tasks/[id]
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const auth = await getAuthContext()
  if (!auth.ok) return auth.response
  const { supabase, usuario } = auth

  // Captura mínima para o histórico antes do hard-delete (não altera comportamento).
  const { data: alvo } = await supabase
    .from('tasks')
    .select('description')
    .eq('id', id)
    .eq('tenant_id', usuario.tenant_id)
    .maybeSingle()

  // Espelho: capturar os afetados ANTES do delete (a linha e os assignees somem).
  const calAdmin = calendarAdmin()
  const afetados = await coletarAfetadosTask(calAdmin, id)

  const { error } = await supabase
    .from('tasks')
    .delete()
    .eq('id', id)
    .eq('tenant_id', usuario.tenant_id)

  if (error) return jsonError(error.message, 500)

  await logAudit({
    tenantId: usuario.tenant_id,
    userId: usuario.id,
    action: 'task.delete',
    resourceType: 'task',
    resourceId: id,
    metadata: { description: alvo?.description ?? null },
  })

  // Espelho: reconcilia os ex-afetados (a tarefa sumiu → removida dos calendários).
  await agendarEspelhoUsuarios(calAdmin, usuario.tenant_id, afetados)

  return NextResponse.json({ ok: true })
}
