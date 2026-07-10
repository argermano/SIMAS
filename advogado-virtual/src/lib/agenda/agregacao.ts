// Normalizadores PUROS: transformam linhas cruas das 3 fontes em EventoCalendario.
// Zero I/O — a API é quem busca no banco e monta as linhas no formato de entrada abaixo.

import type {
  EventoCalendario,
  Prioridade,
  Pessoa,
  ProcessoRef,
  ClienteRef,
  TagAgenda,
} from './tipos'

/** Cores por prioridade (fallback quando a tarefa não tem tag). */
const COR_PRIORIDADE: Record<Prioridade, string> = {
  baixa: '#22c55e',
  media: '#3b82f6',
  alta: '#f59e0b',
  urgente: '#ef4444',
}
const COR_SEM_PRIORIDADE = '#6b7280'
const COR_EVENTO_PADRAO = '#3b82f6'
const COR_CONSULTA = '#8b5cf6'

/** Linha de entrada para `tarefaParaEvento` (montada pela API a partir de `tasks` + joins). */
export interface TarefaRow {
  id: string
  description: string
  /** Data manual da tarefa (ISO). A API só passa tarefas COM data. */
  due_date: string
  priority: Prioridade | null
  completed_at: string | null
  created_by: string | null
  origin_reference: string | null
  responsavel: Pessoa | null
  envolvidos: Pessoa[]
  processo: ProcessoRef | null
  cliente: ClienteRef | null
  tags: TagAgenda[]
}

/** Linha de entrada para `eventoParaEvento` (montada a partir de `agenda_eventos` + joins). */
export interface AgendaEventoRow {
  id: string
  tipo: 'evento' | 'prazo' | 'audiencia'
  titulo: string
  descricao?: string | null
  local?: string | null
  inicio: string
  fim: string | null
  dia_todo: boolean
  status: 'a_concluir' | 'concluida' | 'cancelada'
  cor: string | null
  visibilidade: 'escritorio' | 'particular'
  created_by: string | null
  responsavel: Pessoa | null
  envolvidos: Pessoa[]
  processo: ProcessoRef | null
  cliente: ClienteRef | null
}

/** Linha de entrada para `consultaParaEvento` (montada a partir de `funil_leads`). */
export interface ConsultaRow {
  id: string
  nome: string | null
  area: string | null
  /** Data/hora da consulta (ISO). A API só passa leads COM consulta_data. */
  consulta_data: string
  consulta_formato: string | null
  meet_url: string | null
  consulta_cancelada: boolean
  cliente: ClienteRef | null
}

/** Tarefa (`tasks`) → EventoCalendario. All-day; cor = 1ª tag ou cor por prioridade. */
export function tarefaParaEvento(row: TarefaRow): EventoCalendario {
  const cor = row.tags.length > 0
    ? row.tags[0].cor
    : (row.priority ? COR_PRIORIDADE[row.priority] : COR_SEM_PRIORIDADE)

  // `due_date` é uma data-de-parede (vem de <input type="date">, gravada como
  // TIMESTAMPTZ → meia-noite UTC). Ancorar ao meio-dia UTC a partir só da porção
  // de data mantém o dia correto em America/Sao_Paulo (evita o off-by-one em que
  // 00:00Z vira 21:00 do dia anterior em SP). Ver KanbanCalendar (usa slice(0,10)).
  const inicio = `${row.due_date.slice(0, 10)}T12:00:00.000Z`

  return {
    id: `tarefa:${row.id}`,
    fonte: 'tarefa',
    titulo: row.description,
    inicio,
    fim: null,
    diaTodo: true,
    status: row.completed_at ? 'concluida' : 'a_concluir',
    prioridade: row.priority,
    responsavel: row.responsavel,
    envolvidos: row.envolvidos,
    processo: row.processo,
    cliente: row.cliente,
    cor,
    tags: row.tags,
    visibilidade: 'escritorio',
    criadoPor: row.created_by,
    meetUrl: null,
    link: `/tarefas?tarefa=${row.id}`,
  }
}

/** agenda_evento (evento/prazo/audiência) → EventoCalendario. `fonte` = `tipo`. */
export function eventoParaEvento(row: AgendaEventoRow): EventoCalendario {
  return {
    id: `${row.tipo}:${row.id}`,
    fonte: row.tipo,
    titulo: row.titulo,
    inicio: row.inicio,
    fim: row.fim,
    diaTodo: row.dia_todo,
    status: row.status,
    prioridade: null,
    responsavel: row.responsavel,
    envolvidos: row.envolvidos,
    processo: row.processo,
    cliente: row.cliente,
    cor: row.cor ?? COR_EVENTO_PADRAO,
    tags: [],
    visibilidade: row.visibilidade,
    criadoPor: row.created_by,
    meetUrl: null,
    link: `/agenda?evento=${row.id}`,
    descricao: row.descricao ?? null,
    local: row.local ?? null,
  }
}

/** Consulta do bot (`funil_leads`) → EventoCalendario. Cancelada => status cancelada. */
export function consultaParaEvento(row: ConsultaRow): EventoCalendario {
  return {
    id: `consulta:${row.id}`,
    fonte: 'consulta',
    titulo: row.nome ?? 'Consulta',
    inicio: row.consulta_data,
    fim: null,
    diaTodo: false,
    status: row.consulta_cancelada ? 'cancelada' : 'a_concluir',
    prioridade: null,
    responsavel: null,
    envolvidos: [],
    processo: null,
    cliente: row.cliente,
    cor: COR_CONSULTA,
    tags: [],
    visibilidade: 'escritorio',
    criadoPor: null,
    meetUrl: row.meet_url,
    link: `/funil?lead=${row.id}`,
  }
}
