/**
 * Remove artefatos de markdown que não devem aparecer no documento final
 * nem na prévia do editor — usado por AMBOS (markdownToDocx e o editor),
 * para que a prévia reflita o que será exportado:
 * - cercas de código (```), que a IA coloca ao redor de seções/citações;
 * - INDENTAÇÃO no início da linha (≥4 espaços ou tab), que o renderizador de
 *   markdown interpreta como bloco de código (fonte monoespaçada) — peças
 *   jurídicas não usam indentação semântica no markdown;
 * - escape de pontuação introduzido pelo editor (turndown): \[ → [, \. → ., \( → (.
 * Mantém * e ` (itálico/negrito são tratados na renderização; cercas já removidas).
 */
export function limparMarkdownParaDocx(markdown: string): string {
  return markdown
    .split('\n')
    .filter((line) => !/^\s*```[a-zA-Z]*\s*$/.test(line))
    .join('\n')
    .replace(/^[ \t]+/gm, '') // remove indentação que vira "bloco de código"
    .replace(/\\([[\]().!_~|{}+])/g, '$1')
}
