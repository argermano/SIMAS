import type { BadgeProps } from '@/components/ui/badge'
import {
  classificarMovimento,
  prioridadeDaCategoria,
  type CategoriaMovimento,
  type PrioridadeRelevancia,
} from '@/lib/processos/categorias'

/** Processo cadastrado no SIMAS (Fase 5) ao qual a publicação está vinculada.
 * DTO derivado do join publicacoes.processo_id → processos → clientes. Todos os
 * campos são anuláveis; a UI degrada por `processo_id` quando este objeto não
 * vier no payload (ex.: antes do enriquecimento server-side). */
export interface ProcessoVinculado {
  id: string | null
  /** CNJ mascarado do processo (fallback: `numero_mascara` da própria publicação). */
  numeroMascara: string | null
  /** Rótulo amigável: apelido || classe (o "título/partes" do estilo Astrea). */
  titulo: string | null
  /** 'ativo' | 'encerrado' (situacao do processo). */
  situacao: string | null
  clienteId: string | null
  clienteNome: string | null
}

/** Item da lista paginada — shape de GET /api/publicacoes.
 * `processoVinculado` é opcional: quando ausente, a coluna PROCESSO usa apenas o
 * número (grau de vínculo inferido por `processo_id`). */
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
  /** "Autor × Réu" (de meta.destinatarios) — identidade do caso, estilo Astrea. */
  partes?: string | null
  /** Nome do advogado monitorado (destinatário cuja OAB casou). */
  advogado?: string | null
  /** Categoria curada + prioridade de RELEVÂNCIA (não prazo) derivadas no servidor.
   * Opcionais: se ausentes (payload antigo), a UI deriva no cliente. */
  categoria?: CategoriaMovimento | null
  prioridade?: PrioridadeRelevancia
  processoVinculado?: ProcessoVinculado | null
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
  /** Movimento da Fase 5 gerado a partir desta publicação (se casou com processo
   * cadastrado). Presente ⇒ aviso ao cliente já foi gerado pela Fase 5. */
  movimento_id: string | null
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

/** Resumo por OAB monitorada (chips do topo): só inscrições com ≥1 publicação na
 * caixa. `novas` = 'nova' disponibilizadas hoje (SP); `total` = todas no tenant. */
export interface OabResumo {
  oab: string
  uf: string
  novas: number
  total: number
}

/** Alerta de captura: a rodada MAIS RECENTE de uma OAB terminou em falha/parcial —
 * os diários podem estar incompletos e o usuário precisa de ciência explícita. */
export interface AlertaCaptura {
  oab: string
  uf: string
  status: 'falha' | 'parcial'
  erro: string | null
  quando: string | null
}

/** Payload de GET /api/publicacoes/saude. `contadores` e `porOab` chegam junto. */
export interface SaudePublicacoes {
  novas: number
  ultimas: UltimaCaptura[]
  ultimaSucessoEm: string | null
  contadores?: ContadoresPublicacoes
  porOab?: OabResumo[]
  alertas?: AlertaCaptura[]
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

/* ── Prioridade = hint de RELEVÂNCIA (nunca de prazo) ─────────────────────────
 * O nível vem PRONTO do servidor no item de lista (`prioridade`). Para o DETALHE
 * (a rota /[id] não devolve o campo) e como fallback do payload antigo, deriva-se
 * no cliente pela MESMA função do servidor (prioridadeDaCategoria ∘ classificar),
 * garantindo lista e detalhe idênticos. NÃO tem relação com prazo — só sinaliza
 * quão substantivo é o ato (sentença > despacho > juntada). Rótulo neutro. */
export type PrioridadeHint = PrioridadeRelevancia

/** Rótulo curto + classes de cor por nível. Cores de ACENTO (relevância), nunca
 * o vermelho de urgência-por-prazo — a relevância alta ≠ prazo curto. */
export const PRIORIDADE_META: Record<PrioridadeHint, { label: string; dot: string; texto: string; ring: string }> = {
  alta:  { label: 'Alta',  dot: 'bg-warning',              texto: 'text-warning',          ring: 'ring-warning/40' },
  media: { label: 'Média', dot: 'bg-primary',              texto: 'text-primary',          ring: 'ring-primary/30' },
  baixa: { label: 'Baixa', dot: 'bg-muted-foreground/50',  texto: 'text-muted-foreground', ring: 'ring-border' },
}

/** Deriva o nível de relevância no cliente (detalhe / fallback), com a MESMA
 * regra do servidor: classifica pela categoria e mapeia com prioridadeDaCategoria. */
export function prioridadeDaPublicacao(input: {
  tipo_documento?: string | null
  tipo_comunicacao?: string | null
  texto?: string | null
}): PrioridadeHint {
  const tipo = input.tipo_documento || input.tipo_comunicacao || ''
  const texto = (input.texto || '').slice(0, 400)
  // Espelha classificarPublicacao do servidor: quando NADA casa, a categoria cai
  // em 'publicacao' (não null) — assim lista e detalhe derivam o MESMO nível.
  const cat = classificarMovimento({ nome: `${tipo}. ${texto}` }) ?? 'publicacao'
  return prioridadeDaCategoria(cat)
}

export const PRIORIDADE_OPCOES = [
  { value: 'baixa',   label: 'Baixa' },
  { value: 'media',   label: 'Média' },
  { value: 'alta',    label: 'Alta' },
  { value: 'urgente', label: 'Urgente' },
] as const

export type Prioridade = (typeof PRIORIDADE_OPCOES)[number]['value']
