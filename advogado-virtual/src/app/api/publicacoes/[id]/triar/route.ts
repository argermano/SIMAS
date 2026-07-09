import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { createClient } from '@/lib/supabase/server'
import { getAuthContext, requireRole } from '@/lib/auth'
import { jsonError, validateBody } from '@/lib/api'
import { logAudit } from '@/lib/audit'
import { logger } from '@/lib/logger'
import { taskService } from '@/services/task-service'
import { validarTransicao, montarDescricaoTarefa } from '@/lib/processos/triagem'

export const maxDuration = 30

type SupabaseServer = Awaited<ReturnType<typeof createClient>>

const tarefaSchema = z.object({
  assignee_id: z.string().uuid(),
  description: z.string().max(2000).optional(),
  due_date: z.string().nullable().optional(),
  priority: z.enum(['baixa', 'media', 'alta', 'urgente']).optional(),
})

const schema = z.object({
  acao: z.enum(['triada', 'descartar', 'tarefa']),
  motivo: z.string().max(2000).optional(),
  tarefa: tarefaSchema.optional(),
})

// Campos suficientes para montar a descrição da tarefa.
const CAMPOS_CLAIM = 'id, status, tipo_documento, tipo_comunicacao, numero_mascara, sigla_tribunal'

interface PublicacaoRow {
  id: string
  status: string
  tipo_documento: string | null
  tipo_comunicacao: string | null
  numero_mascara: string | null
  sigla_tribunal: string | null
}

/**
 * POST /api/publicacoes/[id]/triar — triagem de uma publicação (admin/advogado).
 *
 * Ações:
 *  - 'triada'    → só marca (status='triada').
 *  - 'descartar' → exige `motivo`; grava descarte_motivo (status='descartada').
 *  - 'tarefa'    → reserva atômico nova→'triada', cria tarefa no Kanban e então
 *                  vira 'tarefa_criada'. Se a criação falhar, reverte para 'nova'.
 *
 * CLAIM ATÔMICO (lição da Fase 5): a mudança de status roda como
 * UPDATE ... WHERE id=… AND tenant_id=… AND status='nova' RETURNING. Zero linhas
 * ⇒ outra pessoa já triou (409) — nunca há duas tarefas nem publicação presa.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await getAuthContext()
  if (!auth.ok) return auth.response
  const { supabase, usuario } = auth
  const gate = requireRole(usuario, ['admin', 'advogado'])
  if (gate) return gate

  const { id } = await params

  const parsed = await validateBody(req, schema)
  if (!parsed.ok) return parsed.response
  const { acao, motivo, tarefa } = parsed.data

  // Regras de negócio por ação (mensagens de erro precisas).
  const motivoLimpo = motivo?.trim()
  if (acao === 'descartar' && !motivoLimpo) {
    return jsonError('Motivo é obrigatório para descartar a publicação.', 400)
  }
  if (acao === 'tarefa' && !tarefa) {
    return jsonError('Dados da tarefa (responsável) são obrigatórios.', 400)
  }

  // ── Ações que mudam status diretamente ('triada' e 'descartar') ────────────
  if (acao === 'triada' || acao === 'descartar') {
    const trans = validarTransicao('nova', acao) // guard determinístico do alvo
    if (!trans.ok) return jsonError(trans.motivo, 409)

    const patch: Record<string, unknown> = {
      status: trans.novoStatus,
      triada_por: usuario.id,
      triada_em: new Date().toISOString(),
    }
    if (acao === 'descartar') patch.descarte_motivo = motivoLimpo

    const { data: claim, error } = await supabase
      .from('publicacoes')
      .update(patch)
      .eq('id', id)
      .eq('tenant_id', usuario.tenant_id)
      .eq('status', 'nova')
      .select('id')

    if (error) {
      logger.error('publicacao.triar.update_falha', { publicacaoId: id, acao }, error)
      return jsonError('Falha ao triar a publicação.', 500)
    }
    if (!claim || claim.length === 0) {
      return resolverClaimVazio(supabase, id, usuario.tenant_id)
    }

    await logAudit({
      tenantId: usuario.tenant_id,
      userId: usuario.id,
      action: acao === 'descartar' ? 'publicacao.descartada' : 'publicacao.triada',
      resourceType: 'publicacao',
      resourceId: id,
      metadata: acao === 'descartar' ? { motivo: motivoLimpo } : {},
    })

    return NextResponse.json({ ok: true, status: trans.novoStatus })
  }

  // ── Ação 'tarefa' — reserva atômico → cria tarefa → confirma ──────────────
  // 1) Reserva atômica nova→'triada' (evita corrida de dupla-tarefa). RETURNING
  //    traz os metadados para montar a descrição sem uma leitura extra.
  const { data: reservados, error: reservaErr } = await supabase
    .from('publicacoes')
    .update({ status: 'triada', triada_por: usuario.id, triada_em: new Date().toISOString() })
    .eq('id', id)
    .eq('tenant_id', usuario.tenant_id)
    .eq('status', 'nova')
    .select(CAMPOS_CLAIM)

  if (reservaErr) {
    logger.error('publicacao.triar.reserva_falha', { publicacaoId: id }, reservaErr)
    return jsonError('Falha ao triar a publicação.', 500)
  }
  if (!reservados || reservados.length === 0) {
    return resolverClaimVazio(supabase, id, usuario.tenant_id)
  }
  const pub = reservados[0] as PublicacaoRow

  // 2) Cria a tarefa no Kanban. Descrição vem do body (editável) ou é montada.
  //    dueDate NUNCA vem pré-confirmada — usa o que o body enviar (default null).
  const descricao = tarefa!.description?.trim() || montarDescricaoTarefa(pub)
  let taskId: string
  try {
    const task = await taskService.createAutomatic({
      description: descricao,
      assigneeId: tarefa!.assignee_id,
      tenantId: usuario.tenant_id,
      createdBy: usuario.id,
      priority: tarefa!.priority ?? 'media',
      dueDate: tarefa!.due_date ?? null,
      originReference: `publicacao:${id}`,
      tagNames: ['PUBLICAÇÃO'],
    })
    taskId = task.id as string
  } catch (err) {
    // Criação falhou → reverte a reserva (best-effort) para não prender a publicação.
    logger.error('publicacao.triar.tarefa_falha', { publicacaoId: id }, err)
    await supabase
      .from('publicacoes')
      .update({ status: 'nova', triada_por: null, triada_em: null })
      .eq('id', id)
      .eq('tenant_id', usuario.tenant_id)
      .eq('status', 'triada')
    return jsonError('Falha ao criar a tarefa no Kanban. Tente novamente.', 502)
  }

  // 3) Confirma a transição reservada → 'tarefa_criada' com o task_id.
  const { error: confirmaErr } = await supabase
    .from('publicacoes')
    .update({ status: 'tarefa_criada', task_id: taskId })
    .eq('id', id)
    .eq('tenant_id', usuario.tenant_id)
    .eq('status', 'triada')

  if (confirmaErr) {
    // A tarefa já existe; a publicação fica em 'triada' com a trilha preservada.
    logger.error('publicacao.triar.confirma_falha', { publicacaoId: id, taskId }, confirmaErr)
    return jsonError('Tarefa criada, mas falha ao vincular à publicação.', 500)
  }

  await logAudit({
    tenantId: usuario.tenant_id,
    userId: usuario.id,
    action: 'publicacao.tarefa_criada',
    resourceType: 'publicacao',
    resourceId: id,
    metadata: { task_id: taskId, assignee_id: tarefa!.assignee_id },
  })

  return NextResponse.json({ ok: true, status: 'tarefa_criada', task_id: taskId })
}

/**
 * Claim retornou zero linhas: distingue "não existe" (404) de "já triada" (409)
 * com uma leitura pontual — sem quebrar o contrato (o sucesso não muda).
 */
async function resolverClaimVazio(
  supabase: SupabaseServer,
  id: string,
  tenantId: string,
): Promise<NextResponse> {
  const { data: existe } = await supabase
    .from('publicacoes')
    .select('id')
    .eq('id', id)
    .eq('tenant_id', tenantId)
    .maybeSingle()
  if (!existe) return jsonError('Publicação não encontrada.', 404)
  return jsonError('Publicação já triada.', 409)
}
