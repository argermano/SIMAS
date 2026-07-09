import type { BadgeProps } from '@/components/ui/badge'

/** Item da lista paginada — shape de GET /api/publicacoes. */
export interface PublicacaoListItem {
  id: string
  data_disponibilizacao: string
  data_publicacao_sugerida: string | null
  sigla_tribunal: string | null
  tipo_documento: string | null
  tipo_comunicacao: string | null
  numero_processo: string | null
  numero_mascara: string | null
  orgao_julgador: string | null
  status: PublicacaoStatus
  oab_consultada: string | null
  uf_oab: string | null
  processo_id: string | null
  task_id: string | null
  trecho: string
}

/** Advogado destinatário (shape derivado de destinatarioadvogados[].advogado). */
export interface DestinatarioAdvogado {
  nome?: string
  numero_oab?: string
  uf_oab?: string
}

/** Detalhe — shape de GET /api/publicacoes/[id] → { publicacao }. */
export interface PublicacaoDetalhe extends PublicacaoListItem {
  nome_classe: string | null
  textoPlano: string
  destinatarios: unknown
  link: string | null
  triada_em: string | null
  descarte_motivo: string | null
}

export type PublicacaoStatus = 'nova' | 'triada' | 'tarefa_criada' | 'descartada'

export interface TeamMember {
  id: string
  nome: string | null
}

/** Uma rodada de captura DJEN (shape de GET /api/publicacoes/saude → ultimas[]). */
export interface UltimaCaptura {
  oab: string
  uf: string
  status: 'sucesso' | 'falha' | 'parcial'
  qtd_encontradas: number
  qtd_novas: number
  finalizada_em: string | null
}

/** Contadores estilo Astrea do topo da caixa (recorte "hoje" em America/Sao_Paulo).
 * Fonte única e correta é o servidor (usa data_disponibilizacao e triada_em). */
export interface ContadoresPublicacoes {
  naoTratadasHoje: number
  tratadasHoje: number
  descartadasHoje: number
  naoTratadasTotal: number
}

/** Payload de GET /api/publicacoes/saude. `contadores` chega junto neste incremento. */
export interface SaudePublicacoes {
  novas: number
  ultimas: UltimaCaptura[]
  ultimaSucessoEm: string | null
  contadores?: ContadoresPublicacoes
}

/** Hoje em America/Sao_Paulo no formato YYYY-MM-DD — espelha `hojeSaoPauloISO`
 * do servidor para que o filtro de data do tile case com o contador. */
export function hojeSaoPaulo(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date())
}

type BadgeVariant = NonNullable<BadgeProps['variant']>

/** Rótulo + variante de badge por status, na SEMÂNTICA DE TRATAMENTO
 * (nova=Não tratada/warning, triada=Tratada/secondary,
 * tarefa_criada=Tratada c/ tarefa/success, descartada=Descartada/default).
 * Os `value`s internos permanecem inalterados. */
export const STATUS_META: Record<PublicacaoStatus, { label: string; variant: BadgeVariant }> = {
  nova:          { label: 'Não tratada',       variant: 'warning' },
  triada:        { label: 'Tratada',           variant: 'secondary' },
  tarefa_criada: { label: 'Tratada c/ tarefa', variant: 'success' },
  descartada:    { label: 'Descartada',        variant: 'default' },
}

export const PRIORIDADE_OPCOES = [
  { value: 'baixa',   label: 'Baixa' },
  { value: 'media',   label: 'Média' },
  { value: 'alta',    label: 'Alta' },
  { value: 'urgente', label: 'Urgente' },
] as const

export type Prioridade = (typeof PRIORIDADE_OPCOES)[number]['value']
