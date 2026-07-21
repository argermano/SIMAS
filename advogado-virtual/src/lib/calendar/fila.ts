// server-only: GATILHO do espelho ATIVO no Google Calendar. Módulo FINO usado
// pelas rotas que mutam a agenda (CRUD de agenda_eventos + status, CRUD de tasks
// com due_date) para (1) ENFILEIRAR os usuários afetados e (2) disparar um dreno
// best-effort DELES depois da resposta — o evento aparece no Google em segundos;
// a trava do claim (drenarUsuarios/processarFilaCalendar) impede corrida com o cron.
//
// À prova de falha por design (o espelho é efeito colateral, nunca parte da
// transação do request): try/catch TOTAL, no-op silencioso quando o espelho está
// INERTE (sem as 2 envs) e import DINÂMICO do motor (espelho.ts) + de next/server
// para não arrastar o cliente REST do Calendar para o bundle de cada rota.
// LGPD: nunca loga nomes (só contagens). SERVER-ONLY.

import { createClient as createAdminClient, type SupabaseClient } from '@supabase/supabase-js'
import { logger } from '@/lib/logger'
import { calendarDisponivel } from './api'

/** Client service-role para a fila/coleta (calendar_sync_fila é service-only, 068). */
export function calendarAdmin(): SupabaseClient {
  return createAdminClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
}

/** Remove nulos/duplicados de uma lista de ids. */
function idsUnicos(userIds: Array<string | null | undefined>): string[] {
  return [...new Set(userIds.filter((u): u is string => !!u))]
}

/**
 * Enfileira os usuários dados para espelhar (dedup natural pela PK user_id, 068).
 * Devolve os ids efetivamente enfileirados (ou [] se inerte/sem usuários) para o
 * chamador orquestrar o dreno. `admin` PRECISA ser service-role. Nunca lança.
 */
export async function enfileirarCalendarSync(
  admin: SupabaseClient,
  tenantId: string | null | undefined,
  userIds: Array<string | null | undefined>,
): Promise<string[]> {
  try {
    if (!calendarDisponivel()) return [] // espelho desligado → nada a enfileirar
    if (!tenantId) return []
    const ids = idsUnicos(userIds)
    if (ids.length === 0) return []
    await admin
      .from('calendar_sync_fila')
      .upsert(ids.map((user_id) => ({ user_id, tenant_id: tenantId })), {
        onConflict: 'user_id',
        ignoreDuplicates: true,
      })
    return ids
  } catch (e) {
    logger.error('calendar.fila.enfileirar', { n: userIds.length }, e) // LGPD: só contagem
    return []
  }
}

/**
 * Enfileira os afetados e AGENDA um dreno best-effort deles para DEPOIS da
 * resposta (after() se em request scope; senão fire-and-forget). Handler-facing:
 * as rotas chamam SÓ isto. Nunca lança e é no-op quando o espelho está inerte.
 */
export async function agendarEspelhoUsuarios(
  admin: SupabaseClient,
  tenantId: string | null | undefined,
  userIds: Array<string | null | undefined>,
): Promise<void> {
  const ids = await enfileirarCalendarSync(admin, tenantId, userIds)
  if (ids.length === 0) return

  const dreno = async () => {
    try {
      const { drenarUsuarios } = await import('./espelho')
      await drenarUsuarios(admin, ids, { deadline: Date.now() + 8_000 })
    } catch (e) {
      logger.error('calendar.fila.dreno', { n: ids.length }, e) // LGPD: só contagem
    }
  }

  try {
    // after(): roda após a resposta, dentro do orçamento da função. Fora de request
    // scope (ex.: chamado por um script) after() lança → cai no fire-and-forget.
    const { after } = await import('next/server')
    after(dreno)
  } catch {
    void dreno()
  }
}

/**
 * Usuários cujo espelho é afetado por um agenda_evento: responsável + envolvidos
 * + criador (mesmo conjunto do filtro do feed ICS/espelho). No-op rápido quando o
 * espelho está inerte. Nunca lança. `eventoId` inexistente → [].
 */
export async function coletarAfetadosEvento(
  admin: SupabaseClient,
  eventoId: string,
): Promise<string[]> {
  if (!calendarDisponivel()) return []
  try {
    const { data } = await admin
      .from('agenda_eventos')
      .select('responsavel_id, created_by, agenda_evento_envolvidos(user_id)')
      .eq('id', eventoId)
      .maybeSingle()
    if (!data) return []
    const envolvidos = (data.agenda_evento_envolvidos ?? []) as { user_id: string | null }[]
    return idsUnicos([
      data.responsavel_id as string | null,
      data.created_by as string | null,
      ...envolvidos.map((e) => e.user_id),
    ])
  } catch (e) {
    logger.error('calendar.afetados.evento', {}, e) // LGPD: sem ids/nomes
    return []
  }
}

/**
 * Usuários cujo espelho é afetado por uma task: responsável principal (assignee)
 * + responsáveis extras (task_assignees) + criador. No-op rápido quando inerte.
 * Nunca lança. `taskId` inexistente → [].
 */
export async function coletarAfetadosTask(
  admin: SupabaseClient,
  taskId: string,
): Promise<string[]> {
  if (!calendarDisponivel()) return []
  try {
    const { data } = await admin
      .from('tasks')
      .select('assignee_id, created_by, task_assignees(user_id)')
      .eq('id', taskId)
      .maybeSingle()
    if (!data) return []
    const extras = (data.task_assignees ?? []) as { user_id: string | null }[]
    return idsUnicos([
      data.assignee_id as string | null,
      data.created_by as string | null,
      ...extras.map((a) => a.user_id),
    ])
  } catch (e) {
    logger.error('calendar.afetados.task', {}, e) // LGPD: sem ids/nomes
    return []
  }
}
