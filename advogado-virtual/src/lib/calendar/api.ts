// server-only: cliente REST FINO da Google Calendar API v3 (sem SDK), AUTENTICADO
// POR USUÁRIO. Cada usuário do Workspace ganha um calendário 'SIMAS' e o motor
// (espelho.ts) mantém nele um espelho ATIVO dos eventos do usuário — alternativa ao
// feed ICS (assinatura por URL) que o Google Agenda recusa em produção.
//
// Auth: MESMA service account do Drive (GOOGLE_DRIVE_SA_KEY_BASE64, DWD já
// autorizada), mas com scope calendar e IMPERSONANDO o e-mail do usuário — só
// funciona para e-mails do DOMÍNIO Workspace do impersonador (GOOGLE_DRIVE_IMPERSONATE).
// Usuário fora do domínio (ex.: gmail) fica FORA do espelho (segue no feed ICS).
// Token cacheado POR EMAIL. SERVER-ONLY: manipula chave privada; nunca no cliente.

import { createHash } from 'node:crypto'
import { parseServiceAccount, montarJwtAssertion, type ServiceAccount } from '@/lib/drive/auth'

const BASE = 'https://www.googleapis.com/calendar/v3'
const SCOPE_CALENDAR = 'https://www.googleapis.com/auth/calendar'
const NOME_CAL = 'SIMAS' // summary do calendário que representamos por usuário
const TIMEOUT_MS = 20_000
const MARGEM_EXPIRACAO_S = 60

/** Erro classificado do Calendar. `classe:'delegacao_pendente'` = DWD/scope ainda
 *  não autorizada no Admin Console (a UI mostra a instrução ao dono). */
export class CalendarApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public classe?: 'delegacao_pendente',
  ) {
    super(message)
    this.name = 'CalendarApiError'
  }
}

/** Recurso mínimo de evento do Google Calendar v3 (o que o espelho escreve). */
export interface GoogleData {
  date?: string // dia-todo: 'YYYY-MM-DD' (end é EXCLUSIVO)
  dateTime?: string // com hora: ISO em UTC ('...Z')
}
export interface EventoGoogle {
  id: string
  summary: string
  description?: string
  location?: string
  status: 'confirmed' | 'cancelled'
  start: GoogleData
  end: GoogleData
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/* ── PURO: elegibilidade de domínio ──────────────────────────────────────── */

/** Domínio (minúsculo) de um e-mail, ou null se malformado. Puro. */
export function dominioDoEmail(email: string | null | undefined): string | null {
  const s = (email ?? '').trim().toLowerCase()
  const i = s.lastIndexOf('@')
  if (i <= 0 || i === s.length - 1) return null
  return s.slice(i + 1)
}

/** Elegível ao espelho ATIVO: mesmo domínio Workspace do impersonador. Puro. */
export function emailElegivel(
  email: string | null | undefined,
  emailReferencia: string | null | undefined,
): boolean {
  const d = dominioDoEmail(email)
  const dref = dominioDoEmail(emailReferencia)
  return !!d && !!dref && d === dref
}

/** SA + impersonador presentes? Portão do espelho ativo (false → INERTE). */
export function calendarDisponivel(): boolean {
  return !!process.env.GOOGLE_DRIVE_SA_KEY_BASE64 && !!process.env.GOOGLE_DRIVE_IMPERSONATE
}

/* ── PURO: id estável do evento no Google ────────────────────────────────── */

/**
 * Id do evento no Google DERIVADO ESTÁVEL do id lógico SIMAS ("fonte:rawId").
 * md5 hex (0-9a-f) é subconjunto do charset válido do Google (base32hex: a-v,0-9)
 * e tem 32 chars — dentro do limite. Determinístico ⇒ o mesmo evento lógico
 * sempre mapeia ao MESMO id, tornando o upsert idempotente (insert→409→update).
 */
export function idEventoGoogle(eventoRef: string): string {
  return createHash('md5').update(eventoRef).digest('hex')
}

/* ── Auth por usuário (token cacheado por email) ──────────────────────────── */

let cacheSa: ServiceAccount | null = null
const cacheTokenPorEmail = new Map<string, { valor: string; expiraEmMs: number }>()

function carregarSa(): ServiceAccount {
  if (!cacheSa) cacheSa = parseServiceAccount(process.env.GOOGLE_DRIVE_SA_KEY_BASE64 || '')
  return cacheSa
}

/** Extrai o campo `error` do corpo OAuth (best-effort, sem lançar). */
function erroOAuth(texto: string): string {
  try {
    return String((JSON.parse(texto) as { error?: unknown }).error ?? '')
  } catch {
    return ''
  }
}

/** Access token OAuth2 impersonando `email` (cacheado por email). DWD/scope não
 *  autorizada (401/403 unauthorized_client/access_denied) => CalendarApiError
 *  classificado 'delegacao_pendente'. */
async function obterTokenUsuario(email: string): Promise<string> {
  const cache = cacheTokenPorEmail.get(email)
  if (cache && Date.now() < cache.expiraEmMs) return cache.valor
  const sa = carregarSa()
  const assertion = montarJwtAssertion(sa, { scope: SCOPE_CALENDAR, impersonar: email })
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 10_000)
  try {
    const res = await fetch(sa.token_uri, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion,
      }),
      signal: ctrl.signal,
    })
    const texto = await res.text()
    if (!res.ok) {
      const err = erroOAuth(texto)
      if (res.status === 401 || res.status === 403 || err === 'unauthorized_client' || err === 'access_denied') {
        throw new CalendarApiError(res.status, 'Calendar: delegação/scope não autorizada', 'delegacao_pendente')
      }
      throw new CalendarApiError(res.status, `Calendar token HTTP ${res.status}`)
    }
    const data = JSON.parse(texto) as { access_token?: string; expires_in?: number }
    if (!data.access_token) throw new CalendarApiError(0, 'Calendar token sem access_token')
    const ttl = (data.expires_in ?? 3600) - MARGEM_EXPIRACAO_S
    cacheTokenPorEmail.set(email, { valor: data.access_token, expiraEmMs: Date.now() + Math.max(ttl, 30) * 1000 })
    return data.access_token
  } finally {
    clearTimeout(timer)
  }
}

/** fetch autenticado com timeout + 1 retry em transitório (429/5xx). Devolve a
 *  Response em status DEFINITIVO (ok ou 4xx que o chamador inspeciona: 409/404/410);
 *  lança CalendarApiError em rede/timeout ou transitório esgotado. */
async function calendarFetch(
  email: string,
  url: string,
  init: RequestInit,
): Promise<Response> {
  const token = await obterTokenUsuario(email) // pode lançar delegacao_pendente
  let ultimo: unknown = null
  for (let tentativa = 1; tentativa <= 2; tentativa++) {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS)
    try {
      const res = await fetch(url, {
        ...init,
        signal: ctrl.signal,
        headers: { authorization: `Bearer ${token}`, ...(init.headers ?? {}) },
      })
      const transitorio = res.status === 429 || res.status >= 500
      if (!transitorio) return res // ok OU 4xx definitivo → o chamador decide
      if (tentativa === 2) throw new CalendarApiError(res.status, `Calendar HTTP ${res.status}`)
      ultimo = new CalendarApiError(res.status, `Calendar HTTP ${res.status}`)
    } catch (e) {
      if (e instanceof CalendarApiError && e.status !== 429 && e.status < 500) throw e
      if (tentativa === 2) throw e instanceof CalendarApiError ? e : new CalendarApiError(0, 'Calendar rede/timeout')
      ultimo = e
    } finally {
      clearTimeout(timer)
    }
    await sleep(600 * tentativa)
  }
  throw ultimo instanceof Error ? ultimo : new CalendarApiError(0, 'Calendar falha')
}

/* ── Operações ────────────────────────────────────────────────────────────── */

/** Procura na calendarList do usuário o calendário 'SIMAS' e cria se faltar
 *  (timeZone America/Sao_Paulo; cor discreta best-effort). Devolve o calendarId. */
export async function garantirCalendarioSimas(email: string): Promise<string> {
  const listRes = await calendarFetch(
    email,
    `${BASE}/users/me/calendarList?maxResults=250&fields=items(id,summary,summaryOverride)`,
    { method: 'GET' },
  )
  if (!listRes.ok) throw new CalendarApiError(listRes.status, `Calendar list HTTP ${listRes.status}`)
  const lista = (await listRes.json()) as {
    items?: Array<{ id: string; summary?: string; summaryOverride?: string }>
  }
  const achado = (lista.items ?? []).find((c) => (c.summaryOverride || c.summary) === NOME_CAL)
  if (achado) return achado.id

  const criaRes = await calendarFetch(email, `${BASE}/calendars?fields=id`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ summary: NOME_CAL, timeZone: 'America/Sao_Paulo' }),
  })
  if (!criaRes.ok) throw new CalendarApiError(criaRes.status, `Calendar create HTTP ${criaRes.status}`)
  const novo = (await criaRes.json()) as { id?: string }
  if (!novo.id) throw new CalendarApiError(0, 'Calendar create sem id')

  // Cor discreta (grafite) — cosmético; falha aqui não invalida o calendário.
  try {
    await calendarFetch(email, `${BASE}/users/me/calendarList/${encodeURIComponent(novo.id)}?fields=id`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ colorId: '8' }),
    })
  } catch {
    /* cor é opcional */
  }
  return novo.id
}

/** Insere o evento com id FIXO (derivado); em 409 (id já existe) faz update (PUT).
 *  Idempotente — o mesmo evento lógico sempre cai no mesmo id do Google. */
export async function upsertEvento(email: string, calId: string, evento: EventoGoogle): Promise<void> {
  const base = `${BASE}/calendars/${encodeURIComponent(calId)}/events`
  const insRes = await calendarFetch(email, `${base}?fields=id`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(evento),
  })
  if (insRes.ok) return
  if (insRes.status === 409) {
    const putRes = await calendarFetch(email, `${base}/${encodeURIComponent(evento.id)}?fields=id`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(evento),
    })
    if (putRes.ok) return
    throw new CalendarApiError(putRes.status, `Calendar upsert(update) HTTP ${putRes.status}`)
  }
  throw new CalendarApiError(insRes.status, `Calendar upsert(insert) HTTP ${insRes.status}`)
}

/** Remove o evento pelo id no Google. 404/410 (já sumiu) = ok (idempotente). */
export async function removerEvento(email: string, calId: string, googleEventId: string): Promise<void> {
  const res = await calendarFetch(
    email,
    `${BASE}/calendars/${encodeURIComponent(calId)}/events/${encodeURIComponent(googleEventId)}`,
    { method: 'DELETE' },
  )
  if (res.ok || res.status === 404 || res.status === 410) return
  throw new CalendarApiError(res.status, `Calendar delete HTTP ${res.status}`)
}

/**
 * Verifica BARATO se a delegação (DWD + scope calendar) já está autorizada para
 * `email`: tenta obter um token impersonado (reusa o cache por email → chamadas
 * repetidas são instantâneas). true = delegação OK; false = ainda pendente
 * (delegacao_pendente). Erros de rede/timeout PROPAGAM — o chamador (rota de
 * estado) decide (trata como "não confirmado"). Usado só pela UI de estado.
 */
export async function verificarDelegacao(email: string): Promise<boolean> {
  try {
    await obterTokenUsuario(email)
    return true
  } catch (e) {
    if (e instanceof CalendarApiError && e.classe === 'delegacao_pendente') return false
    throw e
  }
}

/** Descarta os caches (útil em testes / rotação de credencial). */
export function _resetCalendarCache(): void {
  cacheSa = null
  cacheTokenPorEmail.clear()
}
