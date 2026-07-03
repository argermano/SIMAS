import type { TeseCurada } from './tipos'
import { TESES_PREVIDENCIARIO } from './previdenciario'
import { TESES_TRABALHISTA } from './trabalhista'
import { TESES_CIVEL } from './civel'
import { TESES_FAMILIA } from './familia'
import { TESES_MEDICO } from './medico'
import { TESES_CONSUMIDOR } from './consumidor'

export type { TeseCurada, EmentaCurada } from './tipos'

/** Registro da base curada por área. */
export const TESES_POR_AREA: Record<string, TeseCurada[]> = {
  previdenciario: TESES_PREVIDENCIARIO,
  trabalhista:    TESES_TRABALHISTA,
  civel:          TESES_CIVEL,
  familia:        TESES_FAMILIA,
  medico:         TESES_MEDICO,
  consumidor:     TESES_CONSUMIDOR,
}

/** Teses REAIS de uma área (exclui os registros de exemplo/template). */
export function tesesDaArea(area: string): TeseCurada[] {
  return (TESES_POR_AREA[area] ?? []).filter((t) => !t.exemplo)
}

/** Todas as teses (inclui exemplos) — para a biblioteca. */
export function tesesDaAreaComExemplos(area: string): TeseCurada[] {
  return TESES_POR_AREA[area] ?? []
}

/**
 * Bloco de FUNDAMENTAÇÃO VERIFICADA para injetar no prompt de geração. Vazio se
 * a área não tem teses reais curadas. As citações aqui foram conferidas por
 * humano → o modelo pode usá-las literalmente, SEM [VERIFICAR].
 */
export function blocoFundamentacaoParaPrompt(area: string): string {
  const teses = tesesDaArea(area)
  if (teses.length === 0) return ''

  const linhas = teses.map((t) => {
    const cits = [...t.dispositivos, ...t.sumulas].filter(Boolean).join('; ')
    const ementas = t.ementas
      .map((e) => `  > "${e.ementa}" (${e.tribunal}, ${e.processo}, ${e.relator}, j. ${e.julgamento})`)
      .join('\n')
    return [
      `- TESE: ${t.tese}`,
      cits ? `  Fundamentos: ${cits}` : '',
      t.quandoUsar ? `  Quando usar: ${t.quandoUsar}` : '',
      ementas,
    ].filter(Boolean).join('\n')
  }).join('\n')

  return `\n\n## FUNDAMENTAÇÃO VERIFICADA PELO ESCRITÓRIO\nAs teses, dispositivos e ementas abaixo foram CONFERIDOS por advogado do escritório — você PODE usá-los literalmente na fundamentação, SEM marcar [VERIFICAR]. Use apenas os pertinentes ao caso concreto. Qualquer OUTRA jurisprudência mencionada de conhecimento próprio continua exigindo [VERIFICAR].\n\n${linhas}`
}

/**
 * Conjunto normalizado das citações da base de uma área (dispositivos, súmulas,
 * nº de processo das ementas) — para o verificador marcar como "base curada".
 */
export function citacoesDaBase(area: string): Set<string> {
  const norm = (s: string) => s.toLowerCase().replace(/n[º°.]\s*/g, '').replace(/\s+/g, ' ').trim()
  const set = new Set<string>()
  for (const t of tesesDaArea(area)) {
    for (const d of t.dispositivos) set.add(norm(d))
    for (const s of t.sumulas) set.add(norm(s))
    for (const e of t.ementas) set.add(norm(e.processo))
  }
  return set
}
