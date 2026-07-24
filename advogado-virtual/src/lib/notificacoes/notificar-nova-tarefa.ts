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
import { tituloCurtoTarefa } from '@/lib/tarefas/aviso-diario'
import { notificarUsuario, notificacoesAdmin } from './notificar-usuario'
import { destinatariosNovaTarefa } from './destinatarios'

/** Link direto para a tarefa no app. */
function urlDaTarefa(taskId: string): string {
  return `${urlBaseApp().replace(/\/+$/, '')}/tarefas?task=${taskId}`
}

/**
 * Envia o aviso de nova tarefa a cada destinatário (I/O). Best-effort por
 * destinatário. Chamado pelo job agendado — não pelas rotas diretamente.
 */
async function notificarNovaTarefa(
  admin: SupabaseClient,
  args: { taskId: string; descricao: string; destinatarios: string[] },
): Promise<void> {
  const titulo = `Nova tarefa para você: ${tituloCurtoTarefa(args.descricao)}`
  const url = urlDaTarefa(args.taskId)
  let enviados = 0
  for (const userId of args.destinatarios) {
    try {
      const r = await notificarUsuario(admin, {
        userId,
        tipo: 'tarefa_atribuida',
        titulo,
        corpo: args.descricao,
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
