// Busca + normalização das 3 fontes do calendário (tasks, agenda_eventos,
// funil_leads/consultas) num intervalo [de, ate], escopada por tenant.
// Extraída de GET /api/agenda para ser compartilhada com o feed ICS.
//
// IMPORTANTE: esta função NÃO aplica filtros de UI. O corte de visibilidade
// 'particular' de terceiros é feito JÁ NA QUERY quando o chamador passa
// `particularesDe` (defesa em profundidade — a rota /api/agenda e o feed ICS
// passam o usuário; ambos ainda aplicam seus próprios filtros em memória).
// SEM `particularesDe`, retorna TODOS os eventos do tenant no intervalo,
// inclusive 'particular' de qualquer criador — o chamador DEVE cortar.

import type { SupabaseClient } from '@supabase/supabase-js'
import {
  tarefaParaEvento,
  eventoParaEvento,
  consultaParaEvento,
  type TarefaRow,
  type AgendaEventoRow,
  type ConsultaRow,
} from './agregacao'
import type { EventoCalendario, Pessoa, ProcessoRef, ClienteRef, TagAgenda } from './tipos'

export interface JanelaCalendario {
  tenantId: string
  /** Início do intervalo (ISO, inclusivo). */
  de: string
  /** Fim do intervalo (ISO, inclusivo). */
  ate: string
  /**
   * Se informado (users.id), corta 'particular' de OUTROS criadores já na
   * query de agenda_eventos: só visibilidade 'escritorio' OU created_by = id.
   */
  particularesDe?: string
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

/**
 * Busca as 3 fontes no intervalo e normaliza para EventoCalendario[] (agregacao.ts).
 * Lança Error com a mensagem do supabase em caso de falha de query.
 * Funciona tanto com o client de sessão (RLS) quanto com o admin (service role).
 */
export async function buscarEventosCalendario(
  admin: SupabaseClient,
  { tenantId, de, ate, particularesDe }: JanelaCalendario,
): Promise<EventoCalendario[]> {
  // ── Fonte 1: tarefas (tasks) — só as COM due_date no intervalo ─────────────
  // `due_date` é data-de-parede gravada como meia-noite UTC; o intervalo [de,ate]
  // é a janela em SP (deslocada ~3h de UTC). Alargamos ±1 dia para não perder a
  // tarefa de 00:00Z que cai fora da borda por fuso; a grade posiciona por dia SP
  // (chaveDia), então dias adjacentes fetchados a mais simplesmente não renderizam.
  const DIA_MS_TASKS = 86_400_000
  const deTasks = new Date(new Date(de).getTime() - DIA_MS_TASKS).toISOString()
  const ateTasks = new Date(new Date(ate).getTime() + DIA_MS_TASKS).toISOString()
  const { data: tasksData, error: tasksErr } = await admin
    .from('tasks')
    .select(`
      id, description, due_date, priority, completed_at, created_by, origin_reference,
      atendimentos:process_id ( id, area, numero_processo, clientes:cliente_id ( id, nome ) ),
      responsavel:users!tasks_assignee_id_fkey ( id, nome ),
      task_assignees ( users ( id, nome ) ),
      task_tag_links ( task_tags ( name, color ) )
    `)
    .eq('tenant_id', tenantId)
    .not('due_date', 'is', null)
    .gte('due_date', deTasks)
    .lte('due_date', ateTasks)
  if (tasksErr) throw new Error(tasksErr.message)

  // ── Fonte 2: agenda_eventos ────────────────────────────────────────────────
  // Com `particularesDe`, o corte de 'particular' de terceiros acontece já no
  // banco (defesa em profundidade — espelha o corte duro de filtros.ts).
  let queryEventos = admin
    .from('agenda_eventos')
    .select(`
      id, tipo, titulo, descricao, local, inicio, fim, dia_todo, status, cor, visibilidade, created_by,
      atendimentos:process_id ( id, area, numero_processo ),
      clientes:cliente_id ( id, nome ),
      responsavel:users!agenda_eventos_responsavel_id_fkey ( id, nome ),
      agenda_evento_envolvidos ( users ( id, nome ) )
    `)
    .eq('tenant_id', tenantId)
    .gte('inicio', de)
    .lte('inicio', ate)
  if (particularesDe) {
    queryEventos = queryEventos.or(
      `visibilidade.eq.escritorio,created_by.eq.${particularesDe}`,
    )
  }
  const { data: eventosData, error: eventosErr } = await queryEventos
  if (eventosErr) throw new Error(eventosErr.message)

  // ── Fonte 3: consultas (funil_leads com consulta_data) ─────────────────────
  const { data: consultasData, error: consultasErr } = await admin
    .from('funil_leads')
    .select(`
      id, nome_informado, area, consulta_data, consulta_formato, meet_url, consulta_cancelada,
      clientes:cliente_id ( id, nome )
    `)
    .eq('tenant_id', tenantId)
    .not('consulta_data', 'is', null)
    .gte('consulta_data', de)
    .lte('consulta_data', ate)
  if (consultasErr) throw new Error(consultasErr.message)

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

  return eventos
}

/**
 * Filtro "eventos do usuário" (mesmo do feed ICS e da UI): responsável OU
 * envolvido OU criador. Os 'particular' de terceiros já saíram na query (via
 * `particularesDe`); aqui fica só o corte por atribuição. Puro — compartilhado
 * entre o feed ICS e o espelho ativo do Google Calendar.
 */
export function filtrarEventosDoUsuario(
  eventos: EventoCalendario[],
  userId: string,
): EventoCalendario[] {
  return eventos.filter(
    (ev) =>
      ev.responsavel?.id === userId ||
      ev.envolvidos.some((p) => p.id === userId) ||
      ev.criadoPor === userId,
  )
}

/** Janela padrão do calendário pessoal/espelho: [-60d, +180d] a partir de agora. */
export function janelaPadrao(agoraMs: number = Date.now()): { de: string; ate: string } {
  const DIA = 86_400_000
  return {
    de: new Date(agoraMs - 60 * DIA).toISOString(),
    ate: new Date(agoraMs + 180 * DIA).toISOString(),
  }
}
