/**
 * Verificação de existência de norma no LexML (portal oficial de legislação).
 *
 * Estratégia: o resolvedor de URN (https://www.lexml.gov.br/urn/<URN>) devolve,
 * para uma norma existente, uma página com o título do diploma; para uma URN
 * inexistente, uma página cujo marcador é "urn não encontrada". Confirmamos a
 * existência pela ausência desse marcador — não precisa da data completa, só do
 * ano (o resolvedor completa).
 *
 * Cobre apenas normas FEDERAIS (a citação na peça raramente traz a jurisdição).
 * Best-effort: qualquer falha/timeout retorna null (inconclusivo), nunca um
 * falso negativo que derrubasse a validação.
 */

const LEXML_BASE = 'https://www.lexml.gov.br/urn'
const cache = new Map<string, { existe: boolean | null; t: number }>()
const TTL_MS = 60 * 60 * 1000 // 1h

/**
 * @returns true (existe), false (não localizada), null (inconclusivo/erro).
 */
export async function normaExisteNoLexml(urn: string, timeoutMs = 6000): Promise<boolean | null> {
  const cached = cache.get(urn)
  if (cached && Date.now() - cached.t < TTL_MS) return cached.existe

  const resultado = await consultar(urn, timeoutMs)
  // Só cacheia respostas conclusivas (não fixa um erro transitório por 1h).
  if (resultado !== null) cache.set(urn, { existe: resultado, t: Date.now() })
  return resultado
}

async function consultar(urn: string, timeoutMs: number): Promise<boolean | null> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const res = await fetch(`${LEXML_BASE}/${urn}`, {
      signal: ctrl.signal,
      headers: { Accept: 'text/html' },
    })
    if (!res.ok) return null
    const html = await res.text()
    // Marcador do resolvedor quando a URN não corresponde a nenhuma norma.
    if (/urn\s+n[ãa]o\s+encontrada/i.test(html)) return false
    return true
  } catch {
    return null // timeout / rede / abort → inconclusivo
  } finally {
    clearTimeout(timer)
  }
}
