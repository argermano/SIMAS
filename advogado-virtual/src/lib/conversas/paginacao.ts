// Helper puro para decidir se há próxima página de conversas.
// O `meta` do relay é normalizado mas seu shape NÃO é garantido pelo contrato
// (tipado como unknown). Por isso lemos defensivamente sinais comuns e, quando
// nada é conclusivo, retornamos null para que a UI mantenha o comportamento
// anterior (baseado só na quantidade de itens). NUNCA inventa/exige um shape:
// se o relay não mandar esses campos, o resultado é null e nada muda.

function numero(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

function campo(obj: Record<string, unknown>, chaves: string[]): unknown {
  for (const k of chaves) {
    if (k in obj) return obj[k]
  }
  return undefined
}

/**
 * Retorna true/false quando o `meta` traz informação suficiente para saber se há
 * próxima página; retorna null quando o shape é desconhecido/insuficiente.
 *
 * @param meta       o campo `meta` da resposta de listagem (shape não garantido)
 * @param paginaAtual página atualmente exibida (1-based)
 */
export function metaTemProxima(meta: unknown, paginaAtual: number): boolean | null {
  if (!meta || typeof meta !== 'object') return null
  const m = meta as Record<string, unknown>

  // 1) Sinal booleano direto (variações comuns de nomenclatura).
  const flag = campo(m, ['temProxima', 'hasNext', 'has_next', 'hasMore', 'has_more'])
  if (typeof flag === 'boolean') return flag

  // 2) Derivar de total de páginas + página atual.
  const totalPaginas = numero(campo(m, ['totalPaginas', 'totalPages', 'total_pages', 'pageCount', 'page_count']))
  const paginaMeta = numero(campo(m, ['pagina', 'page', 'currentPage', 'current_page'])) ?? paginaAtual
  if (totalPaginas != null) return paginaMeta < totalPaginas

  // 3) Derivar de total de itens + itens por página.
  const total = numero(campo(m, ['total', 'totalCount', 'total_count', 'count']))
  const porPagina = numero(campo(m, ['porPagina', 'perPage', 'per_page', 'pageSize', 'page_size']))
  if (total != null && porPagina != null && porPagina > 0) {
    return paginaMeta * porPagina < total
  }

  return null
}
