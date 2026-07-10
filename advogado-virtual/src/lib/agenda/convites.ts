// Convites de agenda por e-mail (iTIP nível 1): monta o ICS de UM evento
// (reusa gerarICS com METHOD REQUEST/CANCEL) e envia via Resend com anexo
// text/calendar aos participantes (responsável + envolvidos com e-mail).
//
// INVARIANTE (spec Lote 1): TUDO aqui é best-effort — nenhuma função lança;
// falha de e-mail/consulta NUNCA derruba a rota (logger.error e segue).
// Convites saem só para agenda_eventos (nunca consultas/tarefas).

import type { SupabaseClient } from '@supabase/supabase-js'
import { logger } from '@/lib/logger'
import { emailTemplate, urlBaseApp } from '@/lib/email'
import { gerarICS } from './ics'
import { eventoParaEvento, type AgendaEventoRow } from './agregacao'
import type { EventoCalendario } from './tipos'
import { chaveDia } from './grade'

export type MetodoConvite = 'REQUEST' | 'CANCEL'

export interface ParticipanteConvite {
  nome: string
  email: string
}

export interface OpcoesConviteEvento {
  evento: EventoCalendario
  participantes: ParticipanteConvite[]
  metodo: MetodoConvite
  /** SEQUENCE do VEVENT (RFC 5545) — incrementa a cada atualização enviada. */
  sequence: number
}

/** Dados pré-carregados para um convite (útil no DELETE: capture ANTES de apagar). */
export interface DadosConvite {
  evento: EventoCalendario
  participantes: ParticipanteConvite[]
  /** ics_sequence ATUAL do evento no banco. */
  sequence: number
}

type ClienteMinimo = Pick<SupabaseClient, 'from'>

/** Normaliza um embed to-one do supabase-js (pode vir objeto OU array). */
function one<T>(v: T | T[] | null | undefined): T | null {
  if (Array.isArray(v)) return v[0] ?? null
  return v ?? null
}

/** Escapa texto do usuário antes de interpolar no HTML do e-mail. */
function escaparHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string
  ))
}

/** Dia civil SP do início do evento no formato DD/MM (p/ assunto do e-mail). */
function diaCurto(inicioISO: string): string {
  const [, m, d] = chaveDia(inicioISO).split('-')
  return `${d}/${m}`
}

/** Data/hora legível em pt-BR (America/Sao_Paulo) p/ o corpo do e-mail. */
function quandoLegivel(ev: EventoCalendario): string {
  if (ev.diaTodo) {
    const [a, m, d] = chaveDia(ev.inicio).split('-')
    return `${d}/${m}/${a} (dia todo)`
  }
  const fmt = new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
  const inicio = fmt.format(new Date(ev.inicio))
  if (!ev.fim) return inicio
  const fim = new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit',
  }).format(new Date(ev.fim))
  return `${inicio} às ${fim}`
}

interface UserEmailEmbed { id: string; nome: string | null; email: string | null }

/** Shape cru do select de convite (agenda_eventos + embeds com e-mail). */
interface EventoConviteRaw {
  id: string
  tipo: AgendaEventoRow['tipo']
  titulo: string
  descricao: string | null
  local: string | null
  inicio: string
  fim: string | null
  dia_todo: boolean
  status: AgendaEventoRow['status']
  cor: string | null
  visibilidade: AgendaEventoRow['visibilidade']
  created_by: string | null
  ics_sequence: number | null
  responsavel?: UserEmailEmbed | UserEmailEmbed[] | null
  agenda_evento_envolvidos?: { users: UserEmailEmbed | UserEmailEmbed[] | null }[] | null
}

const COLUNAS_CONVITE = `
  id, tipo, titulo, descricao, local, inicio, fim, dia_todo, status, cor,
  visibilidade, created_by, ics_sequence,
  responsavel:users!agenda_eventos_responsavel_id_fkey ( id, nome, email ),
  agenda_evento_envolvidos ( users ( id, nome, email ) )
`

/**
 * Carrega um agenda_evento (tenant-scoped) já no formato de convite:
 * EventoCalendario + participantes (responsável + envolvidos COM e-mail,
 * dedup por e-mail) + ics_sequence atual. Retorna null se não achar ou em
 * erro (best-effort — nunca lança). Use no DELETE ANTES de apagar a linha.
 */
export async function carregarDadosConvite(
  client: ClienteMinimo,
  tenantId: string,
  eventoId: string,
): Promise<DadosConvite | null> {
  try {
    const { data, error } = await client
      .from('agenda_eventos')
      .select(COLUNAS_CONVITE)
      .eq('id', eventoId)
      .eq('tenant_id', tenantId)
      .maybeSingle()
    if (error || !data) {
      if (error) logger.error('agenda.convite.carregar_falha', { eventoId }, error)
      return null
    }
    const raw = data as unknown as EventoConviteRaw

    const candidatos: UserEmailEmbed[] = []
    const resp = one<UserEmailEmbed>(raw.responsavel)
    if (resp) candidatos.push(resp)
    for (const env of raw.agenda_evento_envolvidos ?? []) {
      const u = one<UserEmailEmbed>(env.users)
      if (u) candidatos.push(u)
    }
    const porEmail = new Map<string, ParticipanteConvite>()
    for (const u of candidatos) {
      if (u.email && !porEmail.has(u.email)) {
        porEmail.set(u.email, { nome: u.nome ?? '', email: u.email })
      }
    }

    const evento = eventoParaEvento({
      id: raw.id,
      tipo: raw.tipo,
      titulo: raw.titulo,
      descricao: raw.descricao,
      local: raw.local,
      inicio: raw.inicio,
      fim: raw.fim,
      dia_todo: raw.dia_todo,
      status: raw.status,
      cor: raw.cor,
      visibilidade: raw.visibilidade,
      created_by: raw.created_by,
      responsavel: resp ? { id: resp.id, nome: resp.nome ?? '' } : null,
      envolvidos: (raw.agenda_evento_envolvidos ?? [])
        .map((e) => one<UserEmailEmbed>(e.users))
        .filter((u): u is UserEmailEmbed => !!u)
        .map((u) => ({ id: u.id, nome: u.nome ?? '' })),
      processo: null,
      cliente: null,
    })

    return {
      evento,
      participantes: [...porEmail.values()],
      sequence: raw.ics_sequence ?? 0,
    }
  } catch (err) {
    logger.error('agenda.convite.carregar_excecao', { eventoId }, err)
    return null
  }
}

/**
 * Envia o convite (ICS de 1 evento, METHOD REQUEST/CANCEL) por e-mail aos
 * participantes via Resend, com anexo text/calendar. Best-effort: retorna
 * `true` se saiu ao menos um e-mail; NUNCA lança. Sem RESEND_API_KEY, só loga.
 */
export async function enviarConviteEvento(
  { evento, participantes, metodo, sequence }: OpcoesConviteEvento,
): Promise<boolean> {
  if (participantes.length === 0) return false
  if (!process.env.RESEND_API_KEY) {
    logger.warn('agenda.convite.resend_ausente', { eventoId: evento.id, metodo })
    return false
  }
  try {
    const base = urlBaseApp()
    const ics = gerarICS([evento], {
      nomeCal: 'SIMAS',
      metodo,
      sequencePorEvento: { [evento.id]: sequence },
      urlBase: base,
      // RFC 5546: REQUEST/CANCEL exigem ORGANIZER + ATTENDEE no VEVENT —
      // sem eles o Gmail/Outlook não processa o convite nem o cancelamento.
      organizador: { nome: 'SIMAS', email: 'contato@simas.app' },
      participantes,
    })

    const cancelado = metodo === 'CANCEL'
    const assunto = `${cancelado ? 'Convite cancelado' : 'Convite'}: ${evento.titulo} - ${diaCurto(evento.inicio)}`
    const link = evento.link.startsWith('/') ? `${base.replace(/\/$/, '')}${evento.link}` : evento.link
    const detalhes = [
      `<p><strong>Quando:</strong> ${escaparHtml(quandoLegivel(evento))}</p>`,
      evento.local ? `<p><strong>Local:</strong> ${escaparHtml(evento.local)}</p>` : '',
      evento.descricao?.trim() ? `<p>${escaparHtml(evento.descricao.trim())}</p>` : '',
      `<p style="color:#94a3b8;font-size:13px;">O arquivo .ics anexo adiciona ${cancelado ? 'o cancelamento' : 'o compromisso'} ao seu calendário (Google Agenda/Outlook).</p>`,
    ].filter(Boolean).join('\n')
    const html = emailTemplate({
      titulo: cancelado
        ? `Cancelado: ${escaparHtml(evento.titulo)}`
        : escaparHtml(evento.titulo),
      conteudo: detalhes,
      botao: { texto: 'Abrir no SIMAS', url: link },
    })

    const { Resend } = await import('resend')
    const resend = new Resend(process.env.RESEND_API_KEY)
    const anexo = {
      filename: cancelado ? 'cancelamento.ics' : 'convite.ics',
      content: Buffer.from(ics, 'utf8').toString('base64'),
      contentType: `text/calendar; charset=utf-8; method=${metodo}`,
    }

    let algumEnviado = false
    for (const p of participantes) {
      try {
        await resend.emails.send({
          from: 'SIMAS <contato@simas.app>',
          to: p.email,
          subject: assunto,
          html,
          attachments: [anexo],
        })
        algumEnviado = true
      } catch (err) {
        logger.error('agenda.convite.envio_falha', { eventoId: evento.id, metodo }, err)
      }
    }
    return algumEnviado
  } catch (err) {
    logger.error('agenda.convite.excecao', { eventoId: evento.id, metodo }, err)
    return false
  }
}

/**
 * Efeito colateral pós-sucesso das rotas de agenda_eventos: carrega o evento
 * + participantes, opcionalmente incrementa `ics_sequence` (updates/cancel via
 * status) e envia o convite. Best-effort — NUNCA lança nem falha a rota.
 */
export async function conviteAposMutacao(
  client: ClienteMinimo,
  opts: {
    tenantId: string
    eventoId: string
    metodo: MetodoConvite
    /** PATCH/status: incrementa ics_sequence no banco e usa no SEQUENCE. */
    incrementarSequence?: boolean
  },
): Promise<void> {
  try {
    const dados = await carregarDadosConvite(client, opts.tenantId, opts.eventoId)
    if (!dados || dados.participantes.length === 0) return

    let sequence = dados.sequence
    if (opts.incrementarSequence) {
      sequence += 1
      const { error } = await client
        .from('agenda_eventos')
        .update({ ics_sequence: sequence })
        .eq('id', opts.eventoId)
        .eq('tenant_id', opts.tenantId)
      if (error) logger.error('agenda.convite.sequence_falha', { eventoId: opts.eventoId }, error)
    }

    await enviarConviteEvento({
      evento: dados.evento,
      participantes: dados.participantes,
      metodo: opts.metodo,
      sequence,
    })
  } catch (err) {
    logger.error('agenda.convite.pos_mutacao_excecao', { eventoId: opts.eventoId }, err)
  }
}
