// Lógica PURA de presença da advogada por unidade (Peça 3 — Agenda Conectada).
// Zero I/O — as rotas (/api/agenda/presencas, /api/integracao/presenca) buscam
// as linhas de `presencas` e usam estas funções para rótulos e projeção.

/** Slugs das unidades do escritório (CHECK da tabela presencas, migration 049). */
export type UnidadePresenca = 'brasilia' | 'florianopolis' | 'blumenau'

export const UNIDADES: UnidadePresenca[] = ['brasilia', 'florianopolis', 'blumenau']

/** Rótulo humano de cada unidade. */
export const ROTULO_UNIDADE: Record<UnidadePresenca, string> = {
  brasilia: 'Brasília',
  florianopolis: 'Florianópolis',
  blumenau: 'Blumenau',
}

/** Linha mínima de `presencas` consumida pela projeção. */
export interface PresencaRow {
  /** Dia da presença (YYYY-MM-DD). */
  data: string
  unidade: UnidadePresenca
}

/**
 * Datas FUTURAS (>= hoje, inclusive) em que há presença na `unidade`,
 * ordenadas ascendente e sem duplicatas, limitadas a `limite`.
 * `hojeISO` é o dia civil de referência (YYYY-MM-DD) — comparação lexicográfica.
 */
export function proximasPresencas(
  rows: PresencaRow[],
  unidade: UnidadePresenca,
  hojeISO: string,
  limite: number,
): string[] {
  if (limite <= 0) return []
  const datas = new Set<string>()
  for (const r of rows) {
    if (r.unidade !== unidade) continue
    const dia = r.data.slice(0, 10)
    if (dia >= hojeISO) datas.add(dia)
  }
  return [...datas].sort().slice(0, limite)
}
