// Helpers PUROS do scroll infinito da lista de conversas (coluna esquerda).
// O relay repassa cada página do Chatwoot na ORDEM do servidor (mais ativa
// primeiro); aqui só acumulamos/mesclamos preservando essa ordem e sem duplicar
// id (chave do React). Nada de rede/DOM: fácil de testar.

import type { Conversa } from './tipos'

/** Página do Chatwoot (default). Fim da lista = página que volta com MENOS que isso. */
export const TAMANHO_PAGINA_CONVERSAS = 25

/**
 * Remove ids repetidos preservando a PRIMEIRA ocorrência (e a ordem original).
 * Ao concatenar páginas, a 1ª ocorrência é a mais recente (página menor) —
 * exatamente a posição que o servidor quer para um item que "subiu".
 */
export function dedupPorId<T extends { id: number }>(itens: T[]): T[] {
  const vistos = new Set<number>()
  const out: T[] = []
  for (const it of itens) {
    if (vistos.has(it.id)) continue
    vistos.add(it.id)
    out.push(it)
  }
  return out
}

/** Concatena páginas na ordem (1, 2, 3…) e deduplica por id. */
export function mesclarPaginas<T extends { id: number }>(paginas: T[][]): T[] {
  return dedupPorId(paginas.flat())
}

/**
 * Detecção de FIM por CONTAGEM (o meta do Chatwoot não traz total confiável):
 * uma página cheia (>= tamanho) pode ter próxima; menos que isso (inclui 0) = fim.
 */
export function temMaisPorContagem(
  qtdUltimaPagina: number,
  tamanho: number = TAMANHO_PAGINA_CONVERSAS,
): boolean {
  return qtdUltimaPagina >= tamanho
}

// Assinatura compacta dos campos que a lista RENDERIZA. O polling silencioso
// reconstrói a lista e só troca o estado quando isto muda — evita re-render e
// salto de scroll quando nada mudou de verdade.
function assinaturaConversa(c: Conversa): string {
  const um = c.ultimaMensagem
  return [
    c.id,
    c.status,
    c.naoLidas,
    c.aguardandoDesde ?? '',
    c.assignee?.id ?? '',
    c.inbox,
    c.contato.nome ?? '',
    c.contato.telefone ?? '',
    c.contato.avatarUrl ?? '',
    (c.labels ?? []).join('|'),
    um ? `${um.trecho}~${um.timestamp}~${um.direcao ?? ''}` : '',
  ].join('')
}

/** true se as duas listas são visualmente idênticas (mesma ordem + mesmos campos). */
export function mesmaLista(a: Conversa[], b: Conversa[]): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    if (assinaturaConversa(a[i]) !== assinaturaConversa(b[i])) return false
  }
  return true
}
