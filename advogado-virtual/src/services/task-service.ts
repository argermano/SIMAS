/**
 * taskService — criação centralizada de tarefas (manual e automática).
 * Pode ser chamado de qualquer parte do servidor (API routes, server actions, etc.)
 */

import { createClient } from '@/lib/supabase/server'
import { vinculoParaColunas, TABELA_POR_TIPO, type Vinculo } from '@/lib/tarefas/vinculo'

/**
 * Garante que todos os IDs informados existem E pertencem ao tenant.
 * Defesa em profundidade: a RLS protege o insert da própria task, mas não
 * valida que as referências (assignee, board, lista, tags) são do mesmo tenant.
 */
async function validarPertencimentoTenant(
  supabase: Awaited<ReturnType<typeof createClient>>,
  tabela: string,
  ids: (string | null | undefined)[],
  tenantId: string,
) {
  const unicos = [...new Set(ids.filter((id): id is string => !!id))]
  if (unicos.length === 0) return
  const { data, error } = await supabase
    .from(tabela)
    .select('id')
    .eq('tenant_id', tenantId)
    .in('id', unicos)
  if (error) throw new Error(error.message)
  if ((data?.length ?? 0) !== unicos.length) {
    throw new Error(`Referência inválida: um ou mais registros de "${tabela}" não pertencem ao tenant`)
  }
}

export interface CreateTaskInput {
  description:      string
  assigneeId:       string
  tenantId:         string
  createdBy:        string
  priority?:        'baixa' | 'media' | 'alta' | 'urgente'
  dueDate?:         Date | string | null
  processId?:       string | null
  /**
   * Vínculo único da tarefa (cliente | caso | processo). Quando informado, tem
   * precedência sobre `processId` e define as 3 colunas exclusivas (054). Passe
   * `null` para nascer sem vínculo; omita para manter o comportamento legado
   * (só `process_id`).
   */
  vinculo?:         Vinculo | null
  taskListId?:      string | null
  kanbanBoardId?:   string | null
  kanbanColumnId?:  string | null
  origin?:          'manual' | 'automatic'
  originReference?: string | null
  tagIds?:          string[]
  extraAssignees?:  string[]
}

export interface CreateAutomaticTaskInput {
  description:      string
  assigneeId:       string
  tenantId:         string
  createdBy:        string
  priority?:        'baixa' | 'media' | 'alta' | 'urgente'
  dueDate?:         Date | string | null
  processId?:       string | null
  vinculo?:         Vinculo | null   // vínculo único herdado (ver CreateTaskInput.vinculo)
  originReference?: string | null
  tagNames?:        string[]   // nomes de tags — lookup automático
}

const taskService = {
  /**
   * Cria uma tarefa genérica (manual ou automática) com todos os campos.
   */
  async create(input: CreateTaskInput) {
    const supabase = await createClient()

    let kanbanBoardId  = input.kanbanBoardId  ?? null
    let kanbanColumnId = input.kanbanColumnId ?? null
    let taskListId     = input.taskListId     ?? null

    // Auto-resolve: busca board/coluna "A Fazer" padrão do tenant se não informado
    if (!kanbanBoardId) {
      const { data: board } = await supabase
        .from('kanban_boards')
        .select('id, kanban_columns(id, name, position)')
        .eq('tenant_id', input.tenantId)
        .order('created_at')
        .limit(1)
        .single()

      if (board) {
        kanbanBoardId = board.id
        const cols = [...(board.kanban_columns ?? [])].sort(
          (a: { position: number }, b: { position: number }) => a.position - b.position
        )
        kanbanColumnId = cols[0]?.id ?? null  // primeira coluna = "A Fazer"
      }
    }

    // Auto-resolve: busca lista padrão do tenant se não informado
    if (!taskListId) {
      const { data: list } = await supabase
        .from('task_lists')
        .select('id')
        .eq('tenant_id', input.tenantId)
        .order('created_at')
        .limit(1)
        .single()
      taskListId = list?.id ?? null
    }

    // Vínculo único (054): quando informado, define as 3 colunas exclusivas e
    // tem precedência sobre `processId`. Omitido → comportamento legado (só process_id).
    const colunasVinculo = input.vinculo !== undefined
      ? vinculoParaColunas(input.vinculo)
      : { cliente_id: null, process_id: input.processId ?? null, processo_id: null }

    // Valida que todas as referências pertencem ao tenant antes de inserir
    await Promise.all([
      validarPertencimentoTenant(supabase, 'users', [input.assigneeId, input.createdBy, ...(input.extraAssignees ?? [])], input.tenantId),
      validarPertencimentoTenant(supabase, 'kanban_boards', [kanbanBoardId], input.tenantId),
      validarPertencimentoTenant(supabase, 'task_lists', [taskListId], input.tenantId),
      validarPertencimentoTenant(supabase, 'task_tags', input.tagIds ?? [], input.tenantId),
      // Alvo do vínculo herdado: confirma que existe no tenant (defesa em profundidade).
      input.vinculo
        ? validarPertencimentoTenant(supabase, TABELA_POR_TIPO[input.vinculo.tipo], [input.vinculo.id], input.tenantId)
        : Promise.resolve(),
    ])

    const { data: task, error } = await supabase
      .from('tasks')
      .insert({
        description:      input.description,
        assignee_id:      input.assigneeId,
        tenant_id:        input.tenantId,
        created_by:       input.createdBy,
        priority:         input.priority        ?? 'media',
        due_date:         input.dueDate         ?? null,
        cliente_id:       colunasVinculo.cliente_id,
        process_id:       colunasVinculo.process_id,
        processo_id:      colunasVinculo.processo_id,
        task_list_id:     taskListId,
        kanban_board_id:  kanbanBoardId,
        kanban_column_id: kanbanColumnId,
        origin:           input.origin          ?? 'manual',
        origin_reference: input.originReference ?? null,
      })
      .select()
      .single()

    if (error) throw new Error(error.message)

    if (input.extraAssignees && input.extraAssignees.length > 0) {
      await supabase.from('task_assignees').insert(
        input.extraAssignees.map(uid => ({ task_id: task.id, user_id: uid }))
      )
    }

    if (input.tagIds && input.tagIds.length > 0) {
      await supabase.from('task_tag_links').insert(
        input.tagIds.map(tid => ({ task_id: task.id, tag_id: tid }))
      )
    }

    return task
  },

  /**
   * Criação automática simplificada — resolve board/coluna/lista automaticamente.
   * Use nos pontos de integração do sistema (revisão de docs, prazos, etc.)
   */
  async createAutomatic(input: CreateAutomaticTaskInput) {
    const supabase = await createClient()

    // Lookup de tags por nome
    let tagIds: string[] = []
    if (input.tagNames && input.tagNames.length > 0) {
      const { data: tags } = await supabase
        .from('task_tags')
        .select('id, name')
        .eq('tenant_id', input.tenantId)
        .in('name', input.tagNames)
      tagIds = (tags ?? []).map((t: { id: string }) => t.id)
    }

    return this.create({
      ...input,
      origin: 'automatic',
      tagIds,
    })
  },
}

export { taskService }
