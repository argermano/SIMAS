// Similaridade de Dice sobre multiconjunto de palavras — barata (O(n)).
// Reusada pela taxa de edição (peça gerada × salva) e pelo dedup de teses.

export function tokenizar(s: string): string[] {
  return (s.toLowerCase().match(/\p{L}+|\p{N}+/gu) ?? [])
}

/** Coeficiente de Dice (0 = nada em comum, 1 = idênticos) sobre dois multiconjuntos. */
export function diceSimilaridade(a: string[], b: string[]): number {
  if (a.length === 0 && b.length === 0) return 1
  if (a.length === 0 || b.length === 0) return 0
  const cont = new Map<string, number>()
  for (const w of a) cont.set(w, (cont.get(w) ?? 0) + 1)
  let comum = 0
  for (const w of b) {
    const n = cont.get(w) ?? 0
    if (n > 0) {
      comum++
      cont.set(w, n - 1)
    }
  }
  return (2 * comum) / (a.length + b.length)
}

/** Similaridade entre dois textos (tokeniza + Dice). */
export function similaridadeTexto(a: string, b: string): number {
  return diceSimilaridade(tokenizar(a), tokenizar(b))
}
