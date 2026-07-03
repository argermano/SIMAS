/**
 * Taxa de edição entre o texto GERADO pela IA e o SALVO pelo advogado.
 * 0 = idênticos (nada editado) · 1 = totalmente diferentes.
 *
 * Métrica: dissimilaridade de Dice sobre o multiconjunto de palavras — barata
 * (O(n)), mede quanto do conteúdo mudou ignorando a ordem. É o sinal de
 * curadoria (B6): o prompt cujas peças mais são editadas é o próximo a melhorar.
 * Marcadores [PREENCHER]/[VERIFICAR] são neutralizados (não contam como edição).
 */
export function calcularTaxaEdicao(gerado: string, salvo: string): number {
  const palavras = (s: string): string[] =>
    (s.toLowerCase().replace(/\[(preencher|verificar)\]/g, ' ').match(/\p{L}+|\p{N}+/gu) ?? [])

  const a = palavras(gerado)
  const b = palavras(salvo)
  if (a.length === 0 && b.length === 0) return 0

  const contagem = new Map<string, number>()
  for (const w of a) contagem.set(w, (contagem.get(w) ?? 0) + 1)

  let comum = 0
  for (const w of b) {
    const n = contagem.get(w) ?? 0
    if (n > 0) {
      comum++
      contagem.set(w, n - 1)
    }
  }

  const dice = (2 * comum) / (a.length + b.length)
  return Math.round((1 - dice) * 1000) / 1000
}
