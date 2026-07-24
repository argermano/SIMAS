// server-only: GANCHO de "nova tarefa → avisa os responsáveis". Módulo FINO que
// as rotas de criação individual (POST /api/tasks, triagem de publicações) e de
// REATRIBUIÇÃO (PATCH /api/tasks/[id]) chamam para disparar o aviso DEPOIS da
// resposta. Espelha o padrão de src/lib/calendar/fila.ts:
//  - after() quando em request scope; fora dele, fire-and-forget com catch+log;
//  - try/catch TOTAL: o aviso é efeito colateral e NUNCA quebra a criação;
//  - LGPD: loga só ids/contagens.
//
// NUNCA use em operações em massa/backfill — só nos caminhos individuais.

import type { SupabaseClient } from '@supabase/supabase-js'
import { logger } from '@/lib/logger'
import { urlBaseApp } from '@/lib/email'
import { janelaDiaSaoPaulo, tituloCurtoTarefa } from '@/lib/tarefas/aviso-diario'
import { resolverVinculoView, type TaskVinculoData } from '@/lib/tarefas/vinculo'
import { notificarUsuario, notificacoesAdmin } from './notificar-usuario'
import { destinatariosNovaTarefa } from './destinatarios'

/** Link direto para a tarefa no app. */
function urlDaTarefa(taskId: string): string {
  return `${urlBaseApp().replace(/\/+$/, '')}/tarefas?task=${taskId}`
}

/**
 * Linha de vencimento do aviso (PURA — testável). due_date guarda o DIA como
 * meia-noite UTC (ver TaskCard): comparamos o YYYY-MM-DD com o dia civil de SP.
 * HOJE ganha destaque explícito (pedido do dono); vencida idem; sem data, nada.
 */
export function linhaVencimento(dueDate: string | null, diaHojeSP: string): string | null {
  if (!dueDate) return null
  const dia = dueDate.slice(0, 10)
  const [y, m, d] = dia.split('-')
  const ddmm = `${d}/${m}/${y.slice(2)}`
  if (dia === diaHojeSP) return `⚠️ Vence HOJE (${ddmm})`
  if (dia < diaHojeSP) return `⚠️ VENCIDA desde ${ddmm}`
  return `Vencimento: ${ddmm}`
}

/** Monta título + linhas do corpo do aviso (vencimento, vínculo). O LINK não
 *  entra aqui: cada canal o acrescenta (botão no e-mail, última linha no
 *  WhatsApp) — evita URL duplicada. */
export function montarLinhasAviso(args: {
  descricao: string
  dueDate: string | null
  vinculoRotulo: string | null
  diaHojeSP: string
}): { titulo: string; corpo: string } {
  const linhas: string[] = []
  const venc = linhaVencimento(args.dueDate, args.diaHojeSP)
  if (venc) linhas.push(venc)
  if (args.vinculoRotulo) linhas.push(`Cliente/caso: ${args.vinculoRotulo}`)
  return {
    titulo: `Nova tarefa para você: ${tituloCurtoTarefa(args.descricao)}`,
    corpo: linhas.join('\n'),
  }
}

/**
 * Envia o aviso de nova tarefa a cada destinatário (I/O). Best-effort por
 * destinatário. Chamado pelo job agendado — não pelas rotas diretamente.
 */
async function notificarNovaTarefa(
  admin: SupabaseClient,
  args: { taskId: string; descricao: string; destinatarios: string[] },
): Promise<void> {
  const url = urlDaTarefa(args.taskId)

  // Enriquecimento (pedido do dono): vencimento com destaque de HOJE + vínculo.
  // Buscamos da própria tarefa (1 query pós-resposta) para não tocar os call
  // sites; falha aqui degrada para o aviso simples, nunca cancela o envio.
  let dueDate: string | null = null
  let vinculoRotulo: string | null = null
  try {
    const { data } = await admin
      .from('tasks')
      .select(
        `due_date, cliente_id, process_id, processo_id,
         cliente:clientes!cliente_id(id, nome),
         atendimentos(id, area, numero_processo, clientes(id, nome)),
         processo:processos!processo_id(id, numero_cnj, apelido, clientes(id, nome))`,
      )
      .eq('id', args.taskId)
      .maybeSingle()
    if (data) {
      dueDate = (data.due_date as string | null) ?? null
      const view = resolverVinculoView(data as unknown as TaskVinculoData)
      vinculoRotulo = view ? view.label : null
    }
  } catch (err) {
    logger.error('notificacoes.nova_tarefa.detalhes', { taskId: args.taskId }, err)
  }

  const { titulo, corpo } = montarLinhasAviso({
    descricao: args.descricao,
    dueDate,
    vinculoRotulo,
    diaHojeSP: janelaDiaSaoPaulo(new Date()).dia,
  })
  let enviados = 0
  for (const userId of args.destinatarios) {
    try {
      const r = await notificarUsuario(admin, {
        userId,
        tipo: 'tarefa_atribuida',
        titulo,
        corpo: corpo || args.descricao,
        corpoCurto: corpo || undefined,
        url,
      })
      if (r.email || r.whatsapp) enviados++
    } catch (err) {
      logger.error('notificacoes.nova_tarefa.destinatario', { taskId: args.taskId }, err)
    }
  }
  logger.info('notificacoes.nova_tarefa', {
    taskId: args.taskId,
    destinatarios: args.destinatarios.length,
    enviados,
  })
}

/**
 * Handler-facing: resolve os destinatários (dedup + exclui quem agiu) e AGENDA o
 * envio para depois da resposta. As rotas chamam SÓ isto. Nunca lança e é no-op
 * quando não sobra destinatário (ex.: o próprio criador é o único responsável).
 */
export async function agendarNotificacaoNovaTarefa(args: {
  taskId: string
  descricao: string
  assigneeId?: string | null
  /** Responsáveis adicionais / recém-adicionados (task_assignees). */
  envolvidos?: (string | null | undefined)[]
  /** Quem executou a ação (criador/reatribuidor) — nunca se auto-avisa. */
  excluir?: string | null
}): Promise<void> {
  try {
    const destinatarios = destinatariosNovaTarefa({
      assigneeId: args.assigneeId ?? null,
      envolvidos: args.envolvidos,
      excluir: args.excluir,
    })
    if (destinatarios.length === 0) return

    const admin = notificacoesAdmin()
    const job = () =>
      notificarNovaTarefa(admin, { taskId: args.taskId, descricao: args.descricao, destinatarios }).catch(
        (err) => logger.error('notificacoes.nova_tarefa.job', { taskId: args.taskId }, err),
      )

    try {
      // after(): roda após a resposta, dentro do orçamento da função. Fora de
      // request scope (script/cron) after() lança → cai no fire-and-forget.
      const { after } = await import('next/server')
      after(job)
    } catch {
      void job()
    }
  } catch (err) {
    // Blindagem final: agendar o aviso jamais derruba a criação da tarefa.
    logger.error('notificacoes.nova_tarefa.agendar', { taskId: args.taskId }, err)
  }
}
