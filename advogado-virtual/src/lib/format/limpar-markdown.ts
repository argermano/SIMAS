/**
 * Remove artefatos de markdown que não devem aparecer no documento final
 * nem na prévia do editor — usado por AMBOS (markdownToDocx e o editor),
 * para que a prévia reflita o que será exportado:
 * - cercas de código (```), que a IA coloca ao redor de seções/citações;
 * - escape de pontuação introduzido pelo editor (turndown): \[ → [, \. → ., \( → (.
 * Mantém * e ` (itálico/negrito são tratados na renderização; cercas já removidas).
 */
export function limparMarkdownParaDocx(markdown: string): string {
  return markdown
    .split('\n')
    .filter((line) => !/^\s*```[a-zA-Z]*\s*$/.test(line))
    .join('\n')
    .replace(/\\([[\]().!_~|{}+])/g, '$1')
}
