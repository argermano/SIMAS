// Extração PURA do provável NOME do cliente a partir do título da tarefa.
//
// Convenção herdada do Astrea (ver classificarAcaoTarefa em acao.ts): os títulos
// de peça nascem como "CLIENTE x PARTE: <peça>. PUB dd/mm" — o CLIENTE é a parte
// à ESQUERDA do separador " x " (autor x réu). Usamos essa heurística para pré-
// buscar clientes/processos que casem quando a tarefa não tem vínculo nenhum
// (assistente de vínculo, PART 2b). Título fora da convenção (sem " x ", ou sem
// nome legível à esquerda) → null → o assistente abre a busca vazia, sem sugestão.
//
// Determinístico e sem I/O — testável isoladamente.

/**
 * Devolve o provável nome do cliente (parte à esquerda do " x ") ou null.
 * - exige o separador " x " com espaços (não casa "Max", "box", "9x12");
 * - descarta índices/pontuação nas pontas ("12. MARIA x …" → "MARIA");
 * - exige ≥ 3 caracteres alfabéticos (evita "ré", "a", números soltos);
 * - limita a 120 chars (o campo de busca corta bem antes).
 */
export function nomeProvavelDoTitulo(titulo: string | null | undefined): string | null {
  const t = (titulo ?? '').trim()
  if (!t) return null

  // Parte autora (cliente) = tudo antes do primeiro " x " (case-insensitive).
  const m = t.match(/^(.+?)\s+x\s+/i)
  if (!m) return null

  const nome = m[1]
    .replace(/^[\d\W_]+/, '')   // remove índice/pontuação inicial ("12. ", "- ")
    .replace(/[\s.,;:]+$/, '')  // remove pontuação final
    .trim()

  const letras = (nome.match(/[a-zA-ZÀ-ÿ]/g) ?? []).length
  if (nome.length < 3 || letras < 3) return null

  return nome.slice(0, 120)
}
