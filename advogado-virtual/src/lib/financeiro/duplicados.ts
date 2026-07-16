// Marcação de POSSÍVEIS DUPLICADOS no inbox de comprovantes (retroativo, para o
// atendente limpar a fila atual): o MESMO comprovante reenviado em mensagens
// diferentes vira linhas distintas — a UNIQUE (tenant_id, mensagem_id) não o
// pega. Função PURA (sem rede) reusada pela rota GET /api/financeiro/comprovantes
// e coberta por teste. Chave forte = endToEndId (E2E do Pix, único por transação
// Pix); fallback sem e2e = valor + data + telefone.
// LGPD: só compara campos já em memória; nada é logado.

export interface ItemDup {
  dados: Record<string, unknown> | null
  telefone: string
}

/**
 * Chave de duplicidade de um item, ou null quando não há sinais suficientes para
 * afirmar duplicidade (aí o item nunca é marcado). Só considera E2E não-vazio;
 * a data é normalizada para AAAA-MM-DD (ignora a hora).
 */
export function chaveDuplicidade(item: ItemDup): string | null {
  const d = item.dados ?? {}
  const e2eRaw = d.endToEndId
  const e2e = typeof e2eRaw === 'string' ? e2eRaw.trim() : ''
  if (e2e) return `e2e:${e2e}`
  const valor = d.valorCentavos
  const dataRaw = d.dataISO
  const data = typeof dataRaw === 'string' ? dataRaw.slice(0, 10) : ''
  if (typeof valor === 'number' && data && item.telefone) return `vdt:${valor}|${data}|${item.telefone}`
  return null
}

/**
 * Devolve os itens com `possivelDuplicado` = true em TODOS os que dividem a mesma
 * chave (aparece 2+ vezes na lista). Preserva os demais campos de cada item.
 */
export function marcarPossiveisDuplicados<T extends ItemDup>(
  itens: T[],
): (T & { possivelDuplicado: boolean })[] {
  const contagem = new Map<string, number>()
  for (const it of itens) {
    const k = chaveDuplicidade(it)
    if (k) contagem.set(k, (contagem.get(k) ?? 0) + 1)
  }
  return itens.map((it) => {
    const k = chaveDuplicidade(it)
    return { ...it, possivelDuplicado: k != null && (contagem.get(k) ?? 0) > 1 }
  })
}
