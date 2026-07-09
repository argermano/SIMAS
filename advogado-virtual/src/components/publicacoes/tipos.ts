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

type BadgeVariant = NonNullable<BadgeProps['variant']>

/** Rótulo + variante de badge por status (Nova=warning, Triada=secondary,
 * Tarefa criada=success, Descartada=default). */
export const STATUS_META: Record<PublicacaoStatus, { label: string; variant: BadgeVariant }> = {
  nova:          { label: 'Nova',          variant: 'warning' },
  triada:        { label: 'Triada',        variant: 'secondary' },
  tarefa_criada: { label: 'Tarefa criada', variant: 'success' },
  descartada:    { label: 'Descartada',    variant: 'default' },
}

export const PRIORIDADE_OPCOES = [
  { value: 'baixa',   label: 'Baixa' },
  { value: 'media',   label: 'Média' },
  { value: 'alta',    label: 'Alta' },
  { value: 'urgente', label: 'Urgente' },
] as const

export type Prioridade = (typeof PRIORIDADE_OPCOES)[number]['value']
