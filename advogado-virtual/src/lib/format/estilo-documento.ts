import type { SupabaseClient } from '@supabase/supabase-js'

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
  cabecalho?: string         // texto do cabeçalho (opcional)
  rodape?: string            // texto do rodapé (opcional)
  numerarPaginas?: boolean   // numeração de páginas no rodapé
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

/** Colunas da tabela padroes_documento. */
interface PadraoRow {
  fonte?: string | null
  tamanho_pt?: number | string | null
  tamanho_ementa_pt?: number | string | null
  entrelinha?: number | string | null
  recuo_primeira_linha_cm?: number | string | null
  recuo_blockquote_cm?: number | string | null
  margem_topo_cm?: number | string | null
  margem_baixo_cm?: number | string | null
  margem_esquerda_cm?: number | string | null
  margem_direita_cm?: number | string | null
  cabecalho?: string | null
  rodape?: string | null
  numerar_paginas?: boolean | null
}

const num = (v: unknown): number | undefined =>
  v == null || v === '' ? undefined : Number(v)

/** Mapeia uma linha de padroes_documento para EstiloDocumento (com defaults). */
export function rowParaEstilo(row: PadraoRow | null | undefined): EstiloDocumento {
  if (!row) return DEFAULT_ABNT
  return resolverEstilo({
    fonte: row.fonte ?? undefined,
    tamanhoPt: num(row.tamanho_pt),
    tamanhoEmentaPt: num(row.tamanho_ementa_pt),
    entrelinha: num(row.entrelinha),
    recuoPrimeiraLinhaCm: num(row.recuo_primeira_linha_cm),
    recuoBlockquoteCm: num(row.recuo_blockquote_cm),
    margensCm: {
      topo: num(row.margem_topo_cm) ?? DEFAULT_ABNT.margensCm.topo,
      baixo: num(row.margem_baixo_cm) ?? DEFAULT_ABNT.margensCm.baixo,
      esquerda: num(row.margem_esquerda_cm) ?? DEFAULT_ABNT.margensCm.esquerda,
      direita: num(row.margem_direita_cm) ?? DEFAULT_ABNT.margensCm.direita,
    },
    cabecalho: row.cabecalho ?? undefined,
    rodape: row.rodape ?? undefined,
    numerarPaginas: row.numerar_paginas ?? undefined,
  })
}

/**
 * Carrega o estilo efetivo do escritório (padroes_documento) com fallback
 * para o DEFAULT_ABNT. Nunca lança — em erro, retorna o default.
 */
export async function carregarEstiloTenant(
  supabase: SupabaseClient,
  tenantId: string,
): Promise<EstiloDocumento> {
  try {
    const { data } = await supabase
      .from('padroes_documento')
      .select('*')
      .eq('tenant_id', tenantId)
      .maybeSingle()
    return rowParaEstilo(data as PadraoRow | null)
  } catch {
    return DEFAULT_ABNT
  }
}
