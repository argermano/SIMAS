// Lógica PURA do "Como foi resolvido antes" (rota /api/tasks/[id]/semelhantes).
// Vive fora do arquivo de rota porque o Next só permite exports de handler em
// route.ts — exportar helpers de lá derruba o build ("is not a valid Route
// export field"); aqui ficam testáveis e reutilizáveis.

import { classificarAcaoTarefa, detectarTipoPeca, type AcaoConcreta } from '@/lib/tarefas/acao'
import { colunasParaVinculo } from '@/lib/tarefas/vinculo'
import { TIPOS_PECA } from '@/lib/constants/tipos-peca'

/** O que caracteriza o trabalho de uma tarefa: a família + (só p/ peça) o tipo. */
export interface CriterioSemelhanca {
  acao: AcaoConcreta
  /** Tipo de peça detectado (apelacao/contrarrazoes/...). null = peça genérica
   *  (ex.: MANIFESTAR/EMENDA, sem tipo no mapa) — casa com outra genérica. */
  tipoPeca: string | null
}

/**
 * Deriva o critério do título da tarefa atual. null quando a ação é
 * 'indefinido' (sem família clara não há grupo de referência a buscar).
 */
export function criterioDaTarefa(titulo: string): CriterioSemelhanca | null {
  const acao = classificarAcaoTarefa(titulo)
  if (acao === 'indefinido') return null
  return { acao, tipoPeca: acao === 'peca' ? detectarTipoPeca(titulo) : null }
}

/**
 * Um título candidato "combina" com o critério quando classifica na MESMA ação
 * e — para peça — detecta o MESMO tipo (APELAÇÃO com APELAÇÃO; peça genérica com
 * peça genérica). Comparação por igualdade (inclui null === null).
 */
export function combinaComCriterio(criterio: CriterioSemelhanca, tituloCandidato: string): boolean {
  if (classificarAcaoTarefa(tituloCandidato) !== criterio.acao) return false
  if (criterio.acao === 'peca') return detectarTipoPeca(tituloCandidato) === criterio.tipoPeca
  return true
}

/** Id do atendimento (caso) vinculado à tarefa, ou null quando o vínculo é
 *  cliente/processo/nenhum — só o caso tem peça gerada associada. */
export function atendimentoVinculado(row: {
  cliente_id?: string | null
  process_id?: string | null
  processo_id?: string | null
}): string | null {
  const v = colunasParaVinculo(row)
  return v?.tipo === 'atendimento' ? v.id : null
}

/** Título legível do tipo da peça (fonte única TIPOS_PECA; fallback do slug). */
export function tituloDaPeca(tipo: string): string {
  return TIPOS_PECA[tipo]?.nome ?? tipo.replace(/_/g, ' ')
}
