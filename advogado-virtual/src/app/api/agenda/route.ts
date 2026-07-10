import { NextRequest, NextResponse } from 'next/server'
import { getAuthContext, requireRole } from '@/lib/auth'
import { jsonError } from '@/lib/api'
import {
  tarefaParaEvento,
  eventoParaEvento,
  consultaParaEvento,
  type TarefaRow,
  type AgendaEventoRow,
  type ConsultaRow,
} from '@/lib/agenda/agregacao'
import { aplicaFiltros } from '@/lib/agenda/filtros'
import type {
  EventoCalendario,
  FiltroAgenda,
  FonteAgenda,
  StatusItem,
  Atribuicao,
  Visibilidade,
  Vista,
  Pessoa,
  ProcessoRef,
  ClienteRef,
  TagAgenda,
} from '@/lib/agenda/tipos'

// GET /api/agenda?de&ate&vista&tipos&status&atribuicao&pessoas&equipes&tags&q
// Agrega tarefas + agenda_eventos + consultas (funil_leads) no intervalo [de,ate]
// escopado por tenant, normaliza (agregacao.ts) e filtra (filtros.ts com meUserId).

const FONTES_VALIDAS: FonteAgenda[] = ['tarefa', 'evento', 'prazo', 'audiencia', 'consulta']
const ATRIBUICOES_VALIDAS: Atribuicao[] = ['responsavel', 'envolvido', 'criador']
const EQUIPES_VALIDAS: Visibilidade[] = ['escritorio', 'particular']
const VISTAS_VALIDAS: Vista[] = ['dia', 'semana', 'mes']

/** CSV -> lista de strings limpa (sem vazios). */
function csv(v: string | null): string[] {
  if (!v) return []
  return v.split(',').map(s => s.trim()).filter(Boolean)
}

/** Normaliza um embed to-one do supabase-js (pode vir objeto OU array). */
function one<T>(v: T | T[] | null | undefined): T | null {
  if (Array.isArray(v)) return v[0] ?? null
  return v ?? null
}

/** Referência mínima de pessoa a partir de uma linha de users. */
function pessoaDe(u: { id: string; nome: string | null } | null): Pessoa | null {
  if (!u) return null
  return { id: u.id, nome: u.nome ?? '' }
}

// ── Shapes crus retornados pelo supabase (embeds) ────────────────────────────
interface UserEmbed { id: string; nome: string | null }
interface ClienteEmbed { id: string; nome: string }
interface AtendimentoEmbed {
  id: string
  area: string | null
  numero_processo: string | null
  clientes?: ClienteEmbed | ClienteEmbed[] | null
}

function processoDe(a: AtendimentoEmbed | null): ProcessoRef | null {
  if (!a) return null
  return { id: a.id, titulo: a.area ?? 'Processo', numero: a.numero_processo ?? '' }
}

function clienteDe(c: ClienteEmbed | null): ClienteRef | null {
  return c ? { id: c.id, nome: c.nome } : null
}

interface TaskRaw {
  id: string
  description: string
  due_date: string | null
  priority: TarefaRow['priority']
  completed_at: string | null
  created_by: string | null
  origin_reference: string | null
  atendimentos?: (AtendimentoEmbed & { clientes?: ClienteEmbed | ClienteEmbed[] | null }) | AtendimentoEmbed[] | null
  responsavel?: UserEmbed | UserEmbed[] | null
  task_assignees?: { users: UserEmbed | UserEmbed[] | null }[] | null
  task_tag_links?: { task_tags: { name: string; color: string } | { name: string; color: string }[] | null }[] | null
}

interface EventoRaw {
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
  atendimentos?: AtendimentoEmbed | AtendimentoEmbed[] | null
  clientes?: ClienteEmbed | ClienteEmbed[] | null
  responsavel?: UserEmbed | UserEmbed[] | null
  agenda_evento_envolvidos?: { users: UserEmbed | UserEmbed[] | null }[] | null
}

interface ConsultaRaw {
  id: string
  nome_informado: string | null
  area: string | null
  consulta_data: string | null
  consulta_formato: string | null
  meet_url: string | null
  consulta_cancelada: boolean
  clientes?: ClienteEmbed | ClienteEmbed[] | null
}

export async function GET(req: NextRequest) {
  const auth = await getAuthContext()
  if (!auth.ok) return auth.response
  const gate = requireRole(auth.usuario, ['admin', 'advogado', 'colaborador'])
  if (gate) return gate
  const { supabase, usuario } = auth

  const { searchParams } = new URL(req.url)
  const de = searchParams.get('de')
  const ate = searchParams.get('ate')
  if (!de || !ate) return jsonError('Parâmetros "de" e "ate" são obrigatórios (ISO)', 400)

  const vistaParam = searchParams.get('vista') as Vista | null
  const vista: Vista = vistaParam && VISTAS_VALIDAS.includes(vistaParam) ? vistaParam : 'semana'

  const statusParam = searchParams.get('status')
  const status: FiltroAgenda['status'] =
    statusParam && ['a_concluir', 'concluida', 'cancelada'].includes(statusParam)
      ? (statusParam as StatusItem)
      : 'todas'

  const filtro: FiltroAgenda = {
    de,
    ate,
    vista,
    tipos: csv(searchParams.get('tipos')).filter((t): t is FonteAgenda => FONTES_VALIDAS.includes(t as FonteAgenda)),
    status,
    atribuicao: csv(searchParams.get('atribuicao')).filter((a): a is Atribuicao => ATRIBUICOES_VALIDAS.includes(a as Atribuicao)),
    pessoas: csv(searchParams.get('pessoas')),
    equipes: csv(searchParams.get('equipes')).filter((e): e is Visibilidade => EQUIPES_VALIDAS.includes(e as Visibilidade)),
    tags: csv(searchParams.get('tags')),
    q: searchParams.get('q') ?? '',
  }

  // ── Fonte 1: tarefas (tasks) — só as COM due_date no intervalo ─────────────
  // `due_date` é data-de-parede gravada como meia-noite UTC; o intervalo [de,ate]
  // é a janela em SP (deslocada ~3h de UTC). Alargamos ±1 dia para não perder a
  // tarefa de 00:00Z que cai fora da borda por fuso; a grade posiciona por dia SP
  // (chaveDia), então dias adjacentes fetchados a mais simplesmente não renderizam.
  const DIA_MS_TASKS = 86_400_000
  const deTasks = new Date(new Date(de).getTime() - DIA_MS_TASKS).toISOString()
  const ateTasks = new Date(new Date(ate).getTime() + DIA_MS_TASKS).toISOString()
  const { data: tasksData, error: tasksErr } = await supabase
    .from('tasks')
    .select(`
      id, description, due_date, priority, completed_at, created_by, origin_reference,
      atendimentos:process_id ( id, area, numero_processo, clientes:cliente_id ( id, nome ) ),
      responsavel:users!tasks_assignee_id_fkey ( id, nome ),
      task_assignees ( users ( id, nome ) ),
      task_tag_links ( task_tags ( name, color ) )
    `)
    .eq('tenant_id', usuario.tenant_id)
    .not('due_date', 'is', null)
    .gte('due_date', deTasks)
    .lte('due_date', ateTasks)
  if (tasksErr) return jsonError(tasksErr.message, 500)

  // ── Fonte 2: agenda_eventos — visibilidade particular reforçada na query ───
  const { data: eventosData, error: eventosErr } = await supabase
    .from('agenda_eventos')
    .select(`
      id, tipo, titulo, descricao, local, inicio, fim, dia_todo, status, cor, visibilidade, created_by,
      atendimentos:process_id ( id, area, numero_processo ),
      clientes:cliente_id ( id, nome ),
      responsavel:users!agenda_eventos_responsavel_id_fkey ( id, nome ),
      agenda_evento_envolvidos ( users ( id, nome ) )
    `)
    .eq('tenant_id', usuario.tenant_id)
    .gte('inicio', de)
    .lte('inicio', ate)
    .or(`visibilidade.eq.escritorio,created_by.eq.${usuario.id}`)
  if (eventosErr) return jsonError(eventosErr.message, 500)

  // ── Fonte 3: consultas (funil_leads com consulta_data) ─────────────────────
  const { data: consultasData, error: consultasErr } = await supabase
    .from('funil_leads')
    .select(`
      id, nome_informado, area, consulta_data, consulta_formato, meet_url, consulta_cancelada,
      clientes:cliente_id ( id, nome )
    `)
    .eq('tenant_id', usuario.tenant_id)
    .not('consulta_data', 'is', null)
    .gte('consulta_data', de)
    .lte('consulta_data', ate)
  if (consultasErr) return jsonError(consultasErr.message, 500)

  // ── Normalização (agregacao.ts) ────────────────────────────────────────────
  const eventos: EventoCalendario[] = []

  for (const t of (tasksData ?? []) as unknown as TaskRaw[]) {
    if (!t.due_date) continue
    const atend = one<AtendimentoEmbed>(t.atendimentos)
    const cliente = atend ? clienteDe(one<ClienteEmbed>(atend.clientes)) : null
    const tags: TagAgenda[] = (t.task_tag_links ?? [])
      .map(l => one(l.task_tags))
      .filter((tg): tg is { name: string; color: string } => !!tg)
      .map(tg => ({ nome: tg.name, cor: tg.color }))
    const row: TarefaRow = {
      id: t.id,
      description: t.description,
      due_date: t.due_date,
      priority: t.priority,
      completed_at: t.completed_at,
      created_by: t.created_by,
      origin_reference: t.origin_reference,
      responsavel: pessoaDe(one<UserEmbed>(t.responsavel)),
      envolvidos: (t.task_assignees ?? [])
        .map(a => pessoaDe(one<UserEmbed>(a.users)))
        .filter((p): p is Pessoa => !!p),
      processo: processoDe(atend),
      cliente,
      tags,
    }
    eventos.push(tarefaParaEvento(row))
  }

  for (const e of (eventosData ?? []) as unknown as EventoRaw[]) {
    const row: AgendaEventoRow = {
      id: e.id,
      tipo: e.tipo,
      titulo: e.titulo,
      descricao: e.descricao,
      local: e.local,
      inicio: e.inicio,
      fim: e.fim,
      dia_todo: e.dia_todo,
      status: e.status,
      cor: e.cor,
      visibilidade: e.visibilidade,
      created_by: e.created_by,
      responsavel: pessoaDe(one<UserEmbed>(e.responsavel)),
      envolvidos: (e.agenda_evento_envolvidos ?? [])
        .map(a => pessoaDe(one<UserEmbed>(a.users)))
        .filter((p): p is Pessoa => !!p),
      processo: processoDe(one<AtendimentoEmbed>(e.atendimentos)),
      cliente: clienteDe(one<ClienteEmbed>(e.clientes)),
    }
    eventos.push(eventoParaEvento(row))
  }

  for (const c of (consultasData ?? []) as unknown as ConsultaRaw[]) {
    if (!c.consulta_data) continue
    const cliente = clienteDe(one<ClienteEmbed>(c.clientes))
    const row: ConsultaRow = {
      id: c.id,
      nome: c.nome_informado ?? cliente?.nome ?? null,
      area: c.area,
      consulta_data: c.consulta_data,
      consulta_formato: c.consulta_formato,
      meet_url: c.meet_url,
      consulta_cancelada: c.consulta_cancelada,
      cliente,
    }
    eventos.push(consultaParaEvento(row))
  }

  // ── Filtros (particular cortado SEMPRE via meUserId) ───────────────────────
  const filtrados = aplicaFiltros(eventos, filtro, usuario.id)

  return NextResponse.json({ eventos: filtrados })
}
