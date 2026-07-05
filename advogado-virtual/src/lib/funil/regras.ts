// Regras de movimentação do funil (spec §5) — função pura, testável.

export type EtapaFunil =
  | 'novo_lead' | 'consulta_agendada' | 'consulta_realizada'
  | 'proposta_enviada' | 'contrato_fechado' | 'perdido'

export type AtorMovimentacao = 'ia' | 'humano' | 'sistema'

export type MotivoPerda =
  | 'sem_retorno' | 'achou_caro' | 'fechou_com_outro'
  | 'sem_viabilidade_juridica' | 'fora_da_area_de_atuacao' | 'desistiu' | 'outro'

/** Ordem do funil comercial (perdido é terminal, fora da linha). */
export const ORDEM_ETAPAS: EtapaFunil[] = [
  'novo_lead', 'consulta_agendada', 'consulta_realizada', 'proposta_enviada', 'contrato_fechado',
]

// Etapas que SÓ humanos aplicam/retiram (spec §5).
const ETAPAS_HUMANAS = new Set<EtapaFunil>(['proposta_enviada', 'contrato_fechado', 'perdido'])

export const LABELS_ETAPA: Record<EtapaFunil, string> = {
  novo_lead:          'Novo Lead',
  consulta_agendada:  'Consulta Agendada',
  consulta_realizada: 'Consulta Realizada',
  proposta_enviada:   'Proposta Enviada',
  contrato_fechado:   'Contrato Fechado',
  perdido:            'Perdido',
}

export const LABELS_MOTIVO_PERDA: Record<MotivoPerda, string> = {
  sem_retorno:              'Sem retorno',
  achou_caro:               'Achou caro',
  fechou_com_outro:         'Fechou com outro',
  sem_viabilidade_juridica: 'Sem viabilidade jurídica',
  fora_da_area_de_atuacao:  'Fora da área de atuação',
  desistiu:                 'Desistiu',
  outro:                    'Outro',
}

/**
 * A movimentação `de → para` é permitida para este ator?
 * - HUMANO: move qualquer coisa (inclusive voltar).
 * - IA/SISTEMA: só avança na ordem; NUNCA marca perdido/proposta/fechado, NUNCA
 *   tira um card que já está em proposta/fechado/perdido, NUNCA volta.
 *   (Conflito humano×automação resolve-se aqui devolvendo false → automação
 *   não faz nada, silenciosamente.)
 */
export function podeMover(ator: AtorMovimentacao, de: EtapaFunil, para: EtapaFunil): boolean {
  if (ator === 'humano') return true
  if (de === para) return false
  if (ETAPAS_HUMANAS.has(para)) return false
  if (ETAPAS_HUMANAS.has(de)) return false
  const iDe = ORDEM_ETAPAS.indexOf(de)
  const iPara = ORDEM_ETAPAS.indexOf(para)
  if (iDe === -1 || iPara === -1) return false
  return iPara > iDe
}

/**
 * O cadastro do cliente está completo o bastante para promover pré-cadastro →
 * ativo ao fechar contrato (spec §5)? Exige nome + CPF + endereço preenchidos.
 * Se false, a UI leva a "Completar cadastro". (Não inspeciona o CPF — só presença.)
 */
export function cadastroCompleto(
  c: { nome?: string | null; cpf?: string | null; endereco?: string | null } | null | undefined,
): boolean {
  return !!(c?.nome?.trim() && c?.cpf?.trim() && c?.endereco?.trim())
}
