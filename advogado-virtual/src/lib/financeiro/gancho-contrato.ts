// Financeiro L1 — gancho "contrato assinado" → tarefa automática de gerar parcelas.
// Chamado nos 3 pontos em que um contrato vira 'assinado' (webhook D4Sign,
// marcar-assinado e arquivo-assinado). BEST-EFFORT: nunca lança — a rota que
// confirma a assinatura jamais pode falhar por causa da tarefa.
//
// Nota de arquitetura: o taskService.createAutomatic cria o PRÓPRIO client de
// sessão (cookies) — funciona nas rotas autenticadas, mas quebra em contextos
// sem sessão (webhook D4Sign com service_role, cron/sync). Por isso este módulo
// replica a criação automática usando o client RECEBIDO (admin OU sessão),
// mantendo o mesmo comportamento (board/coluna/lista padrão + origin 'automatic').

import type { SupabaseClient } from '@supabase/supabase-js'
import { logger } from '@/lib/logger'
import { formatarValor } from './parcelas'
import { sincronizarPrevisaoContrato } from './previsao'

type Db = SupabaseClient

export interface TarefaAutomaticaInput {
  tenantId: string
  description: string
  originReference: string // chave de dedup — nunca cria 2ª tarefa com a mesma
  assigneeId?: string | null // fallback: primeiro admin ativo do tenant
  createdBy?: string | null
  processId?: string | null
  priority?: 'baixa' | 'media' | 'alta' | 'urgente'
}

/**
 * Cria uma tarefa automática (origin 'automatic') com DEDUP por origin_reference,
 * usando o client informado (admin ou de sessão). Resolve board/coluna/lista
 * padrão do tenant como o taskService. Retorna se criou (false = já existia,
 * sem assignee resolvível ou erro). NUNCA lança.
 */
export async function criarTarefaAutomatica(db: Db, input: TarefaAutomaticaInput): Promise<{ criada: boolean }> {
  try {
    // Dedup: já existe tarefa com este origin_reference no tenant?
    const { data: existente, error: errDedup } = await db
      .from('tasks')
      .select('id')
      .eq('tenant_id', input.tenantId)
      .eq('origin_reference', input.originReference)
      .limit(1)
    if (errDedup) throw errDedup
    if ((existente?.length ?? 0) > 0) return { criada: false }

    // Assignee: valida pertencimento ao tenant; sem assignee, cai no 1º admin ativo.
    let assigneeId: string | null = null
    if (input.assigneeId) {
      const { data: u } = await db
        .from('users')
        .select('id')
        .eq('id', input.assigneeId)
        .eq('tenant_id', input.tenantId)
        .maybeSingle()
      assigneeId = u?.id ?? null
    }
    if (!assigneeId) {
      const { data: adm } = await db
        .from('users')
        .select('id')
        .eq('tenant_id', input.tenantId)
        .eq('role', 'admin')
        .eq('status', 'ativo')
        .order('created_at')
        .limit(1)
      assigneeId = adm?.[0]?.id ?? null
    }
    if (!assigneeId) {
      logger.warn('financeiro.tarefa_automatica.sem_assignee', { tenantId: input.tenantId, ref: input.originReference })
      return { criada: false }
    }

    // Board/coluna/lista padrão do tenant (mesma resolução do taskService).
    const [{ data: board }, { data: list }] = await Promise.all([
      db
        .from('kanban_boards')
        .select('id, kanban_columns(id, position)')
        .eq('tenant_id', input.tenantId)
        .order('created_at')
        .limit(1)
        .maybeSingle(),
      db.from('task_lists').select('id').eq('tenant_id', input.tenantId).order('created_at').limit(1).maybeSingle(),
    ])
    const cols = [...((board?.kanban_columns as Array<{ id: string; position: number }>) ?? [])].sort(
      (a, b) => a.position - b.position,
    )

    // O índice único parcial (migration 051) fecha a corrida do
    // check-then-insert: 23505 = outro worker criou primeiro (dedup, não erro).
    const { error } = await db.from('tasks').insert({
      description: input.description,
      assignee_id: assigneeId,
      tenant_id: input.tenantId,
      created_by: input.createdBy ?? assigneeId,
      priority: input.priority ?? 'media',
      process_id: input.processId ?? null,
      task_list_id: list?.id ?? null,
      kanban_board_id: board?.id ?? null,
      kanban_column_id: cols[0]?.id ?? null,
      origin: 'automatic',
      origin_reference: input.originReference,
    })
    if (error) {
      if (error.code === '23505') return { criada: false } // já existia (corrida)
      throw error
    }
    return { criada: true }
  } catch (err) {
    logger.error('financeiro.tarefa_automatica.falha', { tenantId: input.tenantId, ref: input.originReference }, err as Error)
    return { criada: false }
  }
}

/**
 * Gancho "contrato assinado": cria tarefa "Gerar parcelas do contrato de <cliente>"
 * com dedup por origin_reference `contrato_financeiro:<id>`. Best-effort — nunca
 * lança nem falha a rota chamadora. `db` pode ser o client de sessão (rotas
 * autenticadas) ou o admin/service_role (webhook D4Sign).
 */
export async function onContratoAssinado(
  db: Db,
  tenantId: string,
  contratoId: string,
  userId: string | null,
): Promise<void> {
  try {
    const { data: contrato } = await db
      .from('contratos_honorarios')
      .select('id, titulo, valor_fixo, forma_pagamento, cliente_id, cliente:clientes(nome)')
      .eq('id', contratoId)
      .eq('tenant_id', tenantId)
      .maybeSingle()
    if (!contrato) return

    const cliente = contrato.cliente as { nome?: string } | { nome?: string }[] | null
    const nomeCliente =
      (Array.isArray(cliente) ? cliente[0]?.nome : cliente?.nome) ?? contrato.titulo ?? 'cliente'

    const partes = [`Gerar parcelas do contrato de ${nomeCliente}`]
    if (contrato.valor_fixo != null) {
      partes.push(`valor ${formatarValor(Math.round(Number(contrato.valor_fixo) * 100))}`)
    }
    partes.push(`forma: ${contrato.forma_pagamento || 'não informada'}`)

    await criarTarefaAutomatica(db, {
      tenantId,
      description: `${partes[0]} — ${partes.slice(1).join(', ')}`,
      originReference: `contrato_financeiro:${contratoId}`,
      assigneeId: userId,
      createdBy: userId,
      priority: 'media',
    })

    // Assinou → garante a previsão de recebimento no financeiro (até a série
    // real ser lançada, que a substitui). Best-effort no próprio helper.
    await sincronizarPrevisaoContrato(db, contratoId)
  } catch (err) {
    // Best-effort: o gancho jamais derruba a confirmação da assinatura.
    logger.error('financeiro.gancho_contrato.falha', { contratoId }, err as Error)
  }
}
