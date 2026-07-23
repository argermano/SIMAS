import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { createClient } from '@/lib/supabase/server'
import { getAuthContext, requireRole } from '@/lib/auth'
import { jsonError, validateBody } from '@/lib/api'
import { logAudit } from '@/lib/audit'
import { logger } from '@/lib/logger'
import { taskService } from '@/services/task-service'
import { derivarVinculoHerdado } from '@/lib/tarefas/heranca-publicacao'
import { validarTransicao, montarDescricaoTarefa, statusAposTratamento } from '@/lib/processos/triagem'

export const maxDuration = 30

type SupabaseServer = Awaited<ReturnType<typeof createClient>>

const tarefaSchema = z.object({
  assignee_id: z.string().uuid(),
  description: z.string().max(2000).optional(),
  due_date: z.string().nullable().optional(),
  priority: z.enum(['baixa', 'media', 'alta', 'urgente']).optional(),
})

const schema = z.object({
  acao: z.enum(['triada', 'descartar', 'tarefa', 'tratar', 'reabrir']),
  motivo: z.string().max(2000).optional(),
  tarefa: tarefaSchema.optional(),
  // Ação 'tratar' (estação de tratamento): nota livre + N tarefas de uma vez.
  nota: z.string().max(2000).optional(),
  tarefas: z.array(tarefaSchema).max(10).optional(),
})

// Campos suficientes para montar a descrição da tarefa + o processo de origem
// (para herdar o vínculo da tarefa no ato da criação).
const CAMPOS_CLAIM = 'id, status, tipo_documento, tipo_comunicacao, numero_mascara, sigla_tribunal, processo_id'

interface PublicacaoRow {
  id: string
  status: string
  tipo_documento: string | null
  tipo_comunicacao: string | null
  numero_mascara: string | null
  sigla_tribunal: string | null
  processo_id: string | null
}

/**
 * POST /api/publicacoes/[id]/triar — triagem de uma publicação (admin/advogado).
 *
 * Ações:
 *  - 'triada'    → só marca (status='triada').
 *  - 'descartar' → exige `motivo`; grava descarte_motivo (status='descartada').
 *  - 'tarefa'    → reserva atômico nova→'triada', cria tarefa no Kanban e então
 *                  vira 'tarefa_criada'. Se a criação falhar, reverte para 'nova'.
 *  - 'tratar'    → estação de tratamento: reserva atômico nova→'triada', grava
 *                  `nota`, cria N tarefas (0..10) e confirma. 0 tarefas → 'triada'
 *                  (tratada sem tarefa); ≥1 → 'tarefa_criada'. Se TODAS as tarefas
 *                  pedidas falharem, reverte para 'nova' (502).
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
  const { acao, motivo, tarefa, nota, tarefas } = parsed.data

  // Regras de negócio por ação (mensagens de erro precisas).
  const motivoLimpo = motivo?.trim()
  if (acao === 'descartar' && !motivoLimpo) {
    return jsonError('Motivo é obrigatório para descartar a publicação.', 400)
  }
  if (acao === 'tarefa' && !tarefa) {
    return jsonError('Dados da tarefa (responsável) são obrigatórios.', 400)
  }

  // ── Reabrir: volta uma publicação já tratada/descartada para 'nova' (fila) ──
  // Claim atômico a partir de qualquer estado não-'nova'. NÃO apaga a tarefa já
  // criada (trabalho real no Kanban) — só limpa a marca de triagem e o motivo.
  if (acao === 'reabrir') {
    const { data: claim, error } = await supabase
      .from('publicacoes')
      .update({ status: 'nova', triada_por: null, triada_em: null, descarte_motivo: null })
      .eq('id', id)
      .eq('tenant_id', usuario.tenant_id)
      .in('status', ['triada', 'tarefa_criada', 'descartada'])
      .select('id')
    if (error) {
      logger.error('publicacao.reabrir.falha', { publicacaoId: id }, error)
      return jsonError('Falha ao reabrir a publicação.', 500)
    }
    if (!claim || claim.length === 0) {
      return jsonError('Esta publicação já está como não tratada.', 409)
    }
    await logAudit({
      tenantId: usuario.tenant_id, userId: usuario.id, action: 'publicacao.reaberta',
      resourceType: 'publicacao', resourceId: id,
    })
    return NextResponse.json({ ok: true, status: 'nova' })
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

  // ── Ação 'tratar' — estação de tratamento: nota + N tarefas de uma vez ─────
  // Reserva atômica nova→'triada' (claim), cria cada tarefa (best-effort), grava
  // a nota e confirma. Status final decidido por statusAposTratamento(nº criadas).
  if (acao === 'tratar') {
    const tarefasPedidas = tarefas ?? []
    const notaLimpa = nota?.trim() || null

    // 1) Reserva atômica (mesmo claim da ação 'tarefa'). RETURNING traz os
    //    metadados p/ montar a descrição default sem uma leitura extra.
    const { data: reservados, error: reservaErr } = await supabase
      .from('publicacoes')
      .update({ status: 'triada', triada_por: usuario.id, triada_em: new Date().toISOString() })
      .eq('id', id)
      .eq('tenant_id', usuario.tenant_id)
      .eq('status', 'nova')
      .select(CAMPOS_CLAIM)

    if (reservaErr) {
      logger.error('publicacao.tratar.reserva_falha', { publicacaoId: id }, reservaErr)
      return jsonError('Falha ao tratar a publicação.', 500)
    }
    if (!reservados || reservados.length === 0) {
      return resolverClaimVazio(supabase, id, usuario.tenant_id)
    }
    const pub = reservados[0] as PublicacaoRow

    // Vínculo herdado da publicação (processo → caso único / processo). Derivado
    // UMA vez: é o mesmo para todas as tarefas desta publicação. Escopo de tenant.
    const vinculoHerdado = await derivarVinculoHerdado(supabase, pub.processo_id, usuario.tenant_id)

    // 2) Cria cada tarefa pedida (best-effort). Descrição vem do body (editável)
    //    ou é montada; dueDate NUNCA vem pré-confirmada (default null).
    const taskIds: string[] = []
    for (const t of tarefasPedidas) {
      try {
        const task = await taskService.createAutomatic({
          description: t.description?.trim() || montarDescricaoTarefa(pub),
          assigneeId: t.assignee_id,
          tenantId: usuario.tenant_id,
          createdBy: usuario.id,
          priority: t.priority ?? 'media',
          dueDate: t.due_date ?? null,
          vinculo: vinculoHerdado,
          originReference: `publicacao:${id}`,
          tagNames: ['PUBLICAÇÃO'],
        })
        taskIds.push(task.id as string)
      } catch (err) {
        logger.error('publicacao.tratar.tarefa_falha', { publicacaoId: id }, err)
      }
    }

    // 3) Se pediram tarefas e TODAS falharam → reverte a reserva e 502.
    if (tarefasPedidas.length > 0 && taskIds.length === 0) {
      await supabase
        .from('publicacoes')
        .update({ status: 'nova', triada_por: null, triada_em: null })
        .eq('id', id)
        .eq('tenant_id', usuario.tenant_id)
        .eq('status', 'triada')
      return jsonError('Falha ao criar as tarefas no Kanban. Tente novamente.', 502)
    }

    // 4) Confirma a transição reservada. status final: 0 tarefas → 'triada';
    //    ≥1 → 'tarefa_criada'. task_id = primeira tarefa criada (se houver).
    const statusFinal = statusAposTratamento(taskIds.length)
    const patch: Record<string, unknown> = { status: statusFinal, tratamento_nota: notaLimpa }
    if (taskIds.length > 0) patch.task_id = taskIds[0]

    const { error: confirmaErr } = await supabase
      .from('publicacoes')
      .update(patch)
      .eq('id', id)
      .eq('tenant_id', usuario.tenant_id)
      .eq('status', 'triada')

    if (confirmaErr) {
      // As tarefas já existem; a publicação fica em 'triada' com a trilha preservada.
      logger.error('publicacao.tratar.confirma_falha', { publicacaoId: id, taskIds }, confirmaErr)
      return jsonError('Tarefas criadas, mas falha ao finalizar o tratamento.', 500)
    }

    await logAudit({
      tenantId: usuario.tenant_id,
      userId: usuario.id,
      action: 'publicacao.tratada',
      resourceType: 'publicacao',
      resourceId: id,
      metadata: { tarefas: taskIds.length },
    })

    return NextResponse.json({ ok: true, status: statusFinal, taskIds })
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

  // Vínculo herdado da publicação (processo → caso único / processo). Escopo de tenant.
  const vinculoHerdado = await derivarVinculoHerdado(supabase, pub.processo_id, usuario.tenant_id)

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
      vinculo: vinculoHerdado,
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
