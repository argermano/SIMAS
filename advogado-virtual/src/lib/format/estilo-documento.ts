/**
 * Estilo de apresentação de documentos jurídicos — fonte ÚNICA de verdade.
 *
 * Separa ESTILO (como o documento é apresentado) do CONTEÚDO (markdown).
 * Hoje alimenta o export DOCX; futuramente alimentará também o CSS do editor
 * e o preview, e poderá ser sobrescrito por escritório (padroes_documento) ou
 * derivado dos metadados do modelo do advogado.
 *
 * Unidades "humanas" (pt, cm, multiplicador) — a conversão para unidades do
 * docx (half-points, twips) é feita no gerador.
 */

export interface MargensCm {
  topo: number
  baixo: number
  esquerda: number
  direita: number
}

export interface EstiloDocumento {
  fonte: string
  tamanhoPt: number          // corpo do texto
  tamanhoEmentaPt: number    // citações/ementas (blockquote)
  entrelinha: number         // multiplicador (1.5 = um e meio)
  recuoPrimeiraLinhaCm: number
  recuoBlockquoteCm: number
  margensCm: MargensCm
}

/** Padrão ABNT/forense — valores iguais aos que estavam hardcoded no gerador. */
export const DEFAULT_ABNT: EstiloDocumento = {
  fonte: 'Times New Roman',
  tamanhoPt: 12,
  tamanhoEmentaPt: 10,
  entrelinha: 1.5,
  recuoPrimeiraLinhaCm: 1.25,
  recuoBlockquoteCm: 4,
  margensCm: { topo: 3, baixo: 2, esquerda: 3, direita: 2 },
}

/**
 * Resolve o estilo efetivo a partir de um override parcial (ex.: config do
 * tenant ou metadados do modelo), com fallback para o DEFAULT_ABNT.
 */
export function resolverEstilo(override?: Partial<EstiloDocumento> | null): EstiloDocumento {
  if (!override) return DEFAULT_ABNT
  return {
    ...DEFAULT_ABNT,
    ...override,
    margensCm: { ...DEFAULT_ABNT.margensCm, ...(override.margensCm ?? {}) },
  }
}
