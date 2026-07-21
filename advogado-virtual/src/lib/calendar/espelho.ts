// server-only: CORAÇÃO do espelho ATIVO no Google Calendar. Monta o estado
// DESEJADO da agenda de UM usuário (MESMA consulta/filtragem do feed ICS) e
// RECONCILIA com o bookkeeping (calendar_espelho, migration 068) + o calendário
// 'SIMAS' do usuário no Google: upsert dos presentes, remoção dos que sumiram e
// dos cancelados. Best-effort por evento — uma falha não aborta o usuário.
//
// Elegibilidade: só e-mails do DOMÍNIO Workspace do impersonador entram; usuário
// fora do domínio (ex.: gmail) é IGNORADO graciosamente (segue no feed ICS).
// INVARIANTE: o espelho só REPLICA eventos existentes — prazo nunca é calculado.
// SERVER-ONLY.

import type { SupabaseClient } from '@supabase/supabase-js'
import { logger } from '@/lib/logger'
import { urlBaseApp } from '@/lib/email'
import { buscarEventosCalendario, filtrarEventosDoUsuario, janelaPadrao } from '@/lib/agenda/consulta'
import { chaveDia } from '@/lib/agenda/grade'
import type { EventoCalendario } from '@/lib/agenda/tipos'
import {
  calendarDisponivel,
  emailElegivel,
  idEventoGoogle,
  garantirCalendarioSimas,
  upsertEvento,
  removerEvento,
  CalendarApiError,
  type EventoGoogle,
} from './api'

type Admin = SupabaseClient

// Janela do CLAIM da fila: um usuário "em processamento" só volta a ser elegível
// por outro dreno após este tempo (protege contra dreno que morreu no meio).
const CLAIM_STALE_MS = 15 * 60_000

// Teto de tentativas: ao atingir este número de falhas consecutivas, o usuário
// vira DEAD-LETTER PASSIVO (fica na fila para inspeção, mas o claim o ignora — não
// queima mais budget). Exportado para o card de status contar só os vivos. Ver 072.
// NÃO conta 'delegacaoPendente' (espera de autorização do admin, não falha terminal).
export const TETO_TENTATIVAS = 8

// Código LGPD-safe do erro para a coluna ultimo_erro: SÓ a classe/status HTTP,
// NUNCA a mensagem (o corpo de erro do Google pode conter e-mail). Puro.
function codigoErroCalendar(e: unknown): string {
  if (e instanceof CalendarApiError) return `http_${e.status}`
  return e instanceof Error ? e.name : 'erro'
}

/* ── PURO: mapeamento EventoCalendario -> recurso do Google ───────────────── */

/** Dia civil SEGUINTE (YYYY-MM-DD) — o end.date do all-day do Google é EXCLUSIVO.
 *  Aritmética em UTC sobre a data civil (sem DST). Puro. */
export function proximoDiaCivil(dia: string): string {
  const [y, m, d] = dia.split('-').map(Number)
  const next = new Date(Date.UTC(y, m - 1, d) + 86_400_000)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${next.getUTCFullYear()}-${p(next.getUTCMonth() + 1)}-${p(next.getUTCDate())}`
}

/**
 * PURO: EventoCalendario -> recurso de evento do Google Calendar v3.
 *  • id: derivado ESTÁVEL do id lógico (idEventoGoogle);
 *  • dia-todo => start/end {date} com o dia civil de SP (end EXCLUSIVO = dia+1);
 *  • com hora => start/end {dateTime} em UTC ('...Z'); sem fim, end = início;
 *  • cancelada => status 'cancelled' (o espelho, porém, REMOVE canceladas);
 *  • descrição inclui o link SIMAS (absoluto se `urlBase`), como no ICS.
 * Testável sem rede.
 */
export function eventoParaGoogle(ev: EventoCalendario, opts?: { urlBase?: string }): EventoGoogle {
  const link =
    ev.link.startsWith('/') && opts?.urlBase ? `${opts.urlBase.replace(/\/$/, '')}${ev.link}` : ev.link
  const description = [ev.descricao?.trim(), `SIMAS: ${link}`].filter(Boolean).join('\n\n')

  let start: EventoGoogle['start']
  let end: EventoGoogle['end']
  if (ev.diaTodo) {
    const diaInicio = chaveDia(ev.inicio)
    const diaFim = ev.fim ? chaveDia(ev.fim) : diaInicio
    start = { date: diaInicio }
    end = { date: proximoDiaCivil(diaFim) } // exclusivo
  } else {
    const inicio = new Date(ev.inicio).toISOString()
    start = { dateTime: inicio }
    end = { dateTime: ev.fim ? new Date(ev.fim).toISOString() : inicio }
  }

  const payload: EventoGoogle = {
    id: idEventoGoogle(ev.id),
    summary: ev.titulo,
    description,
    status: ev.status === 'cancelada' ? 'cancelled' : 'confirmed',
    start,
    end,
  }
  if (ev.local) payload.location = ev.local
  return payload
}

/* ── IMPURO: reconciliação com o Google Calendar ─────────────────────────── */

export interface CalendarContadores {
  /** Fora do domínio / usuário inativo / espelho inerte — TERMINAL (sai da fila). */
  ignorado: boolean
  /** DWD/scope ainda não autorizada — retentar depois (a UI mostra instrução). */
  delegacaoPendente: boolean
  upserts: number
  remocoes: number
  erros: number
  // Classe/código HTTP do ÚLTIMO erro (LGPD: nunca o corpo) — vira ultimo_erro na
  // fila quando o dreno incrementa a tentativa. undefined enquanto erros===0.
  ultimoErro?: string
}

interface EspelhoRow {
  id: string
  evento_ref: string
  google_event_id: string
  calendar_google_id: string | null
}

/**
 * Espelha UM usuário no Google Calendar. No-op/ignorado se o espelho está inerte,
 * o usuário não está ativo ou seu e-mail está fora do domínio. Best-effort por
 * evento: acumula erros mas não aborta. Devolve contadores.
 */
export async function espelharUsuario(admin: Admin, userId: string): Promise<CalendarContadores> {
  const cont: CalendarContadores = { ignorado: false, delegacaoPendente: false, upserts: 0, remocoes: 0, erros: 0 }
  if (!calendarDisponivel()) {
    cont.ignorado = true
    return cont // espelho ativo desligado (INERTE)
  }

  // 1) Usuário ATIVO + e-mail (mesma exigência do feed ICS).
  const { data: user } = await admin
    .from('users')
    .select('id, email, tenant_id, status')
    .eq('id', userId)
    .maybeSingle()
  if (!user || user.status !== 'ativo' || !user.email) {
    cont.ignorado = true
    return cont
  }
  const tenantId = user.tenant_id as string
  const email = user.email as string

  // 2) Só e-mails do domínio Workspace do impersonador entram no espelho ativo.
  if (!emailElegivel(email, process.env.GOOGLE_DRIVE_IMPERSONATE)) {
    cont.ignorado = true
    return cont
  }

  // 3) Calendário 'SIMAS' do usuário (cria se faltar). DWD não autorizada =>
  // delegacao_pendente: nada muda no Google; retentar depois.
  let calId: string
  try {
    calId = await garantirCalendarioSimas(email)
  } catch (e) {
    if (e instanceof CalendarApiError && e.classe === 'delegacao_pendente') {
      cont.delegacaoPendente = true // espera de autorização do admin — não conta tentativa
    } else {
      cont.ultimoErro = codigoErroCalendar(e)
      logger.error('calendar.espelho.calendario', {}, e) // LGPD: sem nomes
    }
    cont.erros++
    return cont
  }

  // 4) Estado DESEJADO = eventos do usuário na janela padrão (MESMA consulta e
  // filtragem do feed ICS): responsável OU envolvido OU criador; 'particular' só
  // do próprio (corte já na query via particularesDe).
  const { de, ate } = janelaPadrao()
  let eventos: EventoCalendario[]
  try {
    eventos = await buscarEventosCalendario(admin, { tenantId, de, ate, particularesDe: userId })
  } catch (e) {
    logger.error('calendar.espelho.busca', {}, e)
    cont.ultimoErro = codigoErroCalendar(e)
    cont.erros++
    return cont
  }
  const meus = filtrarEventosDoUsuario(eventos, userId)

  // 5) Bookkeeping atual do usuário.
  const { data: bkRaw } = await admin
    .from('calendar_espelho')
    .select('id, evento_ref, google_event_id, calendar_google_id')
    .eq('user_id', userId)
  const existentes = (bkRaw ?? []) as EspelhoRow[]

  const urlBase = urlBaseApp()
  const manter = new Set<string>() // evento_refs que devem PERMANECER no Google

  // 6) Upsert dos presentes. Canceladas NÃO entram em `manter` → caem na remoção
  // do passo 7 (o espelho ativo remove o evento em vez de marcá-lo cancelado).
  for (const ev of meus) {
    if (ev.status === 'cancelada') continue
    manter.add(ev.id)
    try {
      const payload = eventoParaGoogle(ev, { urlBase })
      await upsertEvento(email, calId, payload)
      await admin.from('calendar_espelho').upsert(
        {
          tenant_id: tenantId,
          user_id: userId,
          evento_ref: ev.id,
          google_event_id: payload.id,
          calendar_google_id: calId,
        },
        { onConflict: 'user_id,evento_ref' },
      )
      cont.upserts++
    } catch (e) {
      cont.ultimoErro = codigoErroCalendar(e)
      cont.erros++
      logger.error('calendar.espelho.upsert', { fonte: ev.fonte }, e) // LGPD: só a fonte
    }
  }

  // 7) Remoções: bookkeeping órfão — evento sumiu da agenda OU foi cancelado.
  for (const row of existentes) {
    if (manter.has(row.evento_ref)) continue
    try {
      await removerEvento(email, row.calendar_google_id ?? calId, row.google_event_id)
      await admin.from('calendar_espelho').delete().eq('id', row.id)
      cont.remocoes++
    } catch (e) {
      cont.ultimoErro = codigoErroCalendar(e)
      cont.erros++
      logger.error('calendar.espelho.remover', {}, e) // LGPD: sem refs/nomes
    }
  }

  return cont
}

/* ── Drenagem da fila ─────────────────────────────────────────────────────── */

/** Resumo de uma passada de drenagem (fila inteira OU usuários específicos). */
export interface ResumoFilaCalendar {
  usuarios: number
  sucesso: number
  comErro: number
  upserts: number
  remocoes: number
  erros: number
  delegacaoPendente: number
}

function novoResumo(): ResumoFilaCalendar {
  return { usuarios: 0, sucesso: 0, comErro: 0, upserts: 0, remocoes: 0, erros: 0, delegacaoPendente: 0 }
}

/**
 * Reclama UM usuário da fila e o reconcilia. CLAIM atômico em DOIS UPDATEs
 * condicionais (livre; senão claim velho > janela stale). NUNCA .or() com
 * timestamp: bug empírico do PostgREST (ver drive/espelho.ts). O `.lt('tentativas',
 * TETO)` no claim também ignora dead-letter. Sai da fila em sucesso TOTAL
 * (erros===0) ou quando IGNORADO (terminal: fora do domínio / inativo). Em erro
 * REAL, INCREMENTA tentativas + grava ultimo_erro (classe/código) e libera o claim
 * (ao teto → dead-letter passivo). Delegação pendente = espera de autorização do
 * admin: só libera o claim, SEM contar tentativa (senão o usuário viraria
 * dead-letter antes de o admin autorizar). O claim impede corrida cron × botão.
 */
async function reconciliarUsuarioDaFila(
  admin: Admin,
  userId: string,
  staleAntes: string,
  resumo: ResumoFilaCalendar,
): Promise<void> {
  const agoraIso = new Date().toISOString()
  let { data: claim } = await admin
    .from('calendar_sync_fila')
    .update({ processando_em: agoraIso })
    .eq('user_id', userId)
    .is('processando_em', null)
    .lt('tentativas', TETO_TENTATIVAS)
    .select('user_id, tentativas')
  if (!claim || claim.length === 0) {
    const { data: claimStale } = await admin
      .from('calendar_sync_fila')
      .update({ processando_em: agoraIso })
      .eq('user_id', userId)
      .lt('processando_em', staleAntes)
      .lt('tentativas', TETO_TENTATIVAS)
      .select('user_id, tentativas')
    claim = claimStale
  }
  if (!claim || claim.length === 0) return // outro dreno já pegou (ou dead-letter)
  const tentativasAtuais = (claim[0] as { tentativas: number | null }).tentativas ?? 0

  resumo.usuarios++
  const r = await espelharUsuario(admin, userId)
  resumo.upserts += r.upserts
  resumo.remocoes += r.remocoes
  resumo.erros += r.erros
  if (r.delegacaoPendente) resumo.delegacaoPendente++

  if (r.ignorado || r.erros === 0) {
    // Sucesso total OU terminal (ignorado) → sai da fila.
    await admin.from('calendar_sync_fila').delete().eq('user_id', userId)
    if (!r.ignorado) resumo.sucesso++
  } else if (r.delegacaoPendente) {
    // Espera de autorização do admin → só libera o claim (NÃO conta tentativa).
    await admin.from('calendar_sync_fila').update({ processando_em: null }).eq('user_id', userId)
    resumo.comErro++
  } else {
    // Erro real → incrementa tentativa + grava a classe/código (LGPD: só código) e
    // libera o claim; ao atingir o teto o filtro .lt() acima o exclui (dead-letter).
    await admin
      .from('calendar_sync_fila')
      .update({ processando_em: null, tentativas: tentativasAtuais + 1, ultimo_erro: r.ultimoErro ?? null })
      .eq('user_id', userId)
    resumo.comErro++
  }
}

/**
 * Drena a fila (mais antigo primeiro) respeitando o teto de tempo (`deadline` =
 * epoch ms absoluto). No-op se o espelho ativo está desligado. Usado pelo cron
 * (folga do funil-consultas). O enfileiramento (gatilhos) vive em calendar/fila.ts.
 */
export async function processarFilaCalendar(
  admin: Admin,
  opts?: { deadline?: number; max?: number },
): Promise<ResumoFilaCalendar> {
  const resumo = novoResumo()
  if (!calendarDisponivel()) return resumo
  const deadline = opts?.deadline ?? Date.now() + 45_000
  const { data: fila } = await admin
    .from('calendar_sync_fila')
    .select('user_id')
    .lt('tentativas', TETO_TENTATIVAS) // ignora dead-letter (não ocupa o lote nem budget)
    .order('enfileirado_em', { ascending: true })
    .limit(opts?.max ?? 50)

  const staleAntes = new Date(Date.now() - CLAIM_STALE_MS).toISOString()

  for (const row of (fila ?? []) as { user_id: string }[]) {
    if (Date.now() >= deadline) break
    await reconciliarUsuarioDaFila(admin, row.user_id, staleAntes, resumo)
  }

  // Dead-letter passivo: usuários no teto de tentativas ficam para inspeção humana.
  // Loga só a CONTAGEM (LGPD: nunca ids) para o item podre virar algo que se vê.
  const { count: mortos } = await admin
    .from('calendar_sync_fila')
    .select('user_id', { count: 'exact', head: true })
    .gte('tentativas', TETO_TENTATIVAS)
  if (mortos && mortos > 0) logger.warn('calendar.fila.dead_letter', { mortos })

  return resumo
}

/**
 * Drena SÓ os `userIds` dados (dreno pós-mutação e botão "Sincronizar agora"):
 * reclama cada um da fila (mesmo claim que o cron → sem corrida) e reconcilia,
 * até o `deadline`. No-op se o espelho está inerte. Quem não couber no tempo
 * (ou já estiver claimado pelo cron) fica na fila durável para o próximo ciclo.
 */
export async function drenarUsuarios(
  admin: Admin,
  userIds: string[],
  opts?: { deadline?: number },
): Promise<ResumoFilaCalendar> {
  const resumo = novoResumo()
  if (!calendarDisponivel()) return resumo
  const deadline = opts?.deadline ?? Date.now() + 8_000
  const staleAntes = new Date(Date.now() - CLAIM_STALE_MS).toISOString()
  for (const userId of [...new Set(userIds)]) {
    if (Date.now() >= deadline) break
    await reconciliarUsuarioDaFila(admin, userId, staleAntes, resumo)
  }
  return resumo
}

// Re-export p/ conveniência de quem orquestra (mesma superfície de erro).
export { CalendarApiError }
