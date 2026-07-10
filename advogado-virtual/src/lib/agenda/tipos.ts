// Tipos puros do módulo Agenda / Calendário.
// Nenhum I/O aqui — só contratos usados pela lib, pela API e pelo frontend.

/** Origem/tipo de um item agregado no calendário. */
export type FonteAgenda = 'tarefa' | 'evento' | 'prazo' | 'audiencia' | 'consulta'

/** Estado de um item no calendário. */
export type StatusItem = 'a_concluir' | 'concluida' | 'cancelada'

/** Visibilidade de um agenda_evento (particular = só o criador vê). */
export type Visibilidade = 'escritorio' | 'particular'

/** Vista da grade. */
export type Vista = 'dia' | 'semana' | 'mes'

/** Prioridade (herdada de tasks); null para itens sem prioridade. */
export type Prioridade = 'baixa' | 'media' | 'alta' | 'urgente'

/** Referência mínima a uma pessoa (usuário). */
export interface Pessoa {
  id: string
  nome: string
}

/** Tag colorida (nome + cor hex). */
export interface TagAgenda {
  nome: string
  cor: string
}

/** Referência mínima a um processo/atendimento. */
export interface ProcessoRef {
  id: string
  titulo: string
  numero: string
}

/** Referência mínima a um cliente. */
export interface ClienteRef {
  id: string
  nome: string
}

/**
 * Item normalizado do calendário — o formato comum consumido pela grade.
 * `id` é único no formato "fonte:rawId" (ex.: "tarefa:abc", "prazo:xyz").
 * Datas são strings ISO (instantes UTC); a conversão p/ America/Sao_Paulo é na borda (grade.ts).
 */
export interface EventoCalendario {
  id: string
  fonte: FonteAgenda
  titulo: string
  inicio: string
  fim: string | null
  diaTodo: boolean
  status: StatusItem
  prioridade: Prioridade | null
  responsavel: Pessoa | null
  envolvidos: Pessoa[]
  processo: ProcessoRef | null
  cliente: ClienteRef | null
  cor: string
  tags: TagAgenda[]
  visibilidade: Visibilidade
  criadoPor: string | null
  meetUrl: string | null
  link: string
  /** Só preenchido para agenda_eventos (evento/prazo/audiência); usado ao editar. */
  descricao?: string | null
  local?: string | null
}

/** Dimensão de atribuição usada pelo filtro "Minhas atribuições". */
export type Atribuicao = 'responsavel' | 'envolvido' | 'criador'

/**
 * Filtro completo da agenda. Convenções de "vazio = todos":
 * `tipos`, `equipes`, `tags`, `pessoas` vazios => sem restrição naquela dimensão.
 * `status='todas'` => sem restrição de status.
 * `atribuicao` vazio => considera responsável + envolvido + criador.
 */
export interface FiltroAgenda {
  de: string
  ate: string
  vista: Vista
  tipos: FonteAgenda[]
  status: StatusItem | 'todas'
  atribuicao: Atribuicao[]
  pessoas: string[]
  equipes: Visibilidade[]
  tags: string[]
  q: string
}

/** Intervalo [de, ate] (ISO) coberto por uma vista — ambos inclusivos. */
export interface IntervaloVista {
  de: string
  ate: string
}
