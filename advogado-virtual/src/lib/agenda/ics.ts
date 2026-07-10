// Geração PURA de iCalendar (RFC 5545) a partir de EventoCalendario[].
// Zero I/O — quem busca eventos é a rota (via consulta.ts).
//
// DECISÃO DE TIMEZONE (documentada, conforme spec): as datas com hora são
// emitidas em UTC ("...Z"), SEM VTIMEZONE — os instantes de EventoCalendario
// já são UTC e Google Agenda/Outlook convertem para o fuso do usuário na
// exibição. Eventos dia-todo usam VALUE=DATE com o DIA CIVIL de
// America/Sao_Paulo (via chaveDia), que é o dia que o usuário vê no SIMAS.

import type { EventoCalendario } from './tipos'
import { chaveDia } from './grade'

export type MetodoICS = 'PUBLISH' | 'REQUEST' | 'CANCEL'

export interface PessoaICS {
  nome: string
  email: string
}

export interface OpcoesICS {
  /** Nome do calendário (X-WR-CALNAME). */
  nomeCal: string
  /** METHOD do calendário. Default: PUBLISH (feed). REQUEST/CANCEL p/ convites. */
  metodo?: MetodoICS
  /** SEQUENCE por evento (chave = EventoCalendario.id, ex. "evento:abc"). Default 0. */
  sequencePorEvento?: Record<string, number>
  /** Base absoluta p/ o link SIMAS na DESCRIPTION (ex. https://simas.app). Sem ela, usa o link relativo. */
  urlBase?: string
  /** Instante do DTSTAMP (ISO) — injetável p/ testes determinísticos. Default: agora. */
  agora?: string
  /**
   * ORGANIZER do convite. A RFC 5546 (§3.2.2/§3.2.5) OBRIGA ORGANIZER em
   * METHOD REQUEST/CANCEL — sem ele o Gmail não renderiza o card de convite
   * e o cancelamento não é casado com o evento. Ignorado em PUBLISH (feed).
   */
  organizador?: PessoaICS
  /** ATTENDEEs do convite (idem: obrigatórios em REQUEST/CANCEL). Ignorados em PUBLISH. */
  participantes?: PessoaICS[]
}

/** Escapa texto para valores ICS: \ ; , e quebras de linha (RFC 5545 §3.3.11). */
export function escaparICS(texto: string): string {
  return texto
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r\n|\r|\n/g, '\\n')
}

/**
 * Dobra uma linha ICS em pedaços de no máximo 75 OCTETOS (UTF-8), com
 * continuação "CRLF + espaço" (RFC 5545 §3.1). Nunca parte um caractere
 * multi-byte no meio.
 */
export function dobrarLinha(linha: string): string {
  const enc = new TextEncoder()
  const partes: string[] = []
  let atual = ''
  let bytes = 0
  // 1ª linha: 75 octetos; continuações: 74 (o espaço inicial ocupa 1).
  let limite = 75
  for (const ch of linha) {
    const n = enc.encode(ch).length
    if (bytes + n > limite) {
      partes.push(atual)
      atual = ch
      bytes = n
      limite = 74
    } else {
      atual += ch
      bytes += n
    }
  }
  partes.push(atual)
  return partes.join('\r\n ')
}

/** Instante ISO -> formato ICS UTC básico: YYYYMMDDTHHMMSSZ. */
function dataHoraUTC(iso: string): string {
  const d = new Date(iso)
  const p = (n: number, w = 2) => String(n).padStart(w, '0')
  return (
    `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}` +
    `T${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}Z`
  )
}

/** Instante ISO -> data civil de SP no formato ICS DATE: YYYYMMDD. */
function dataSP(iso: string): string {
  return chaveDia(iso).replace(/-/g, '')
}

/** Valor de PARÂMETRO ICS (ex. CN=): sem aspas/CRLF; entre aspas se tiver ; : , (RFC 5545 §3.2). */
function paramICS(valor: string): string {
  const limpo = valor.replace(/["\r\n]/g, '')
  return /[;:,]/.test(limpo) ? `"${limpo}"` : limpo
}

/** Fontes que vêm de agenda_eventos — o `tipo` (prefixo do id) é EDITÁVEL. */
const FONTES_AGENDA_EVENTOS = new Set(['evento', 'prazo', 'audiencia'])

/**
 * UID estável por LINHA do banco. Para agenda_eventos, o id lógico é
 * "tipo:rawId" e o tipo pode ser editado (evento/prazo/audiência) — se o UID
 * seguisse o tipo, um update de convite viraria evento NOVO (duplicata) no
 * calendário do participante. Por isso essas fontes usam o prefixo constante
 * "agenda-<rawId>"; as demais (tarefa/consulta) mantêm "<fonte>:<rawId>".
 */
export function uidICS(id: string): string {
  const sep = id.indexOf(':')
  const fonte = sep > 0 ? id.slice(0, sep) : ''
  if (FONTES_AGENDA_EVENTOS.has(fonte)) return `agenda-${id.slice(sep + 1)}@simas.app`
  return `${id}@simas.app`
}

/**
 * Gera um documento iCalendar (string com CRLF) a partir dos eventos.
 * UID estável por linha do banco (ver uidICS — independe do tipo editável).
 * Cancelados => STATUS:CANCELLED. Dia-todo => DTSTART;VALUE=DATE (dia SP).
 * REQUEST/CANCEL: emite ORGANIZER/ATTENDEE (RFC 5546) quando fornecidos.
 */
export function gerarICS(eventos: EventoCalendario[], opts: OpcoesICS): string {
  const metodo: MetodoICS = opts.metodo ?? 'PUBLISH'
  const dtstamp = dataHoraUTC(opts.agora ?? new Date().toISOString())
  const linhas: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//SIMAS//Agenda//PT-BR',
    'CALSCALE:GREGORIAN',
    `METHOD:${metodo}`,
    `X-WR-CALNAME:${escaparICS(opts.nomeCal)}`,
    'X-WR-TIMEZONE:America/Sao_Paulo',
  ]

  for (const ev of eventos) {
    linhas.push('BEGIN:VEVENT')
    linhas.push(`UID:${uidICS(ev.id)}`)
    linhas.push(`DTSTAMP:${dtstamp}`)
    linhas.push(`SEQUENCE:${opts.sequencePorEvento?.[ev.id] ?? 0}`)
    if (metodo !== 'PUBLISH') {
      if (opts.organizador) {
        linhas.push(
          `ORGANIZER;CN=${paramICS(opts.organizador.nome)}:mailto:${opts.organizador.email}`,
        )
      }
      for (const p of opts.participantes ?? []) {
        linhas.push(
          `ATTENDEE;CN=${paramICS(p.nome)};ROLE=REQ-PARTICIPANT;` +
          `PARTSTAT=NEEDS-ACTION;RSVP=TRUE:mailto:${p.email}`,
        )
      }
    }
    if (ev.diaTodo) {
      linhas.push(`DTSTART;VALUE=DATE:${dataSP(ev.inicio)}`)
      // Sem DTEND: evento de 1 dia inteiro (RFC 5545 §3.6.1).
    } else {
      linhas.push(`DTSTART:${dataHoraUTC(ev.inicio)}`)
      if (ev.fim) linhas.push(`DTEND:${dataHoraUTC(ev.fim)}`)
    }
    linhas.push(`SUMMARY:${escaparICS(ev.titulo)}`)
    const link = ev.link.startsWith('/') && opts.urlBase
      ? `${opts.urlBase.replace(/\/$/, '')}${ev.link}`
      : ev.link
    const descricao = [ev.descricao?.trim(), `SIMAS: ${link}`]
      .filter(Boolean)
      .join('\n\n')
    linhas.push(`DESCRIPTION:${escaparICS(descricao)}`)
    if (ev.local) linhas.push(`LOCATION:${escaparICS(ev.local)}`)
    if (ev.status === 'cancelada' || metodo === 'CANCEL') {
      linhas.push('STATUS:CANCELLED')
    } else {
      linhas.push('STATUS:CONFIRMED')
    }
    linhas.push('END:VEVENT')
  }

  linhas.push('END:VCALENDAR')
  return linhas.map(dobrarLinha).join('\r\n') + '\r\n'
}
