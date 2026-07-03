/**
 * Verificador determinístico de citações (B5.2).
 *
 * Extrai da peça as citações de PROCESSO (nº CNJ), SÚMULA e LEI e as confere
 * contra checagens determinísticas — sem depender do modelo, que é a fonte de
 * alucinação que queremos justamente flagrar. Objetivo: dar ao advogado uma
 * malha de segurança "verificada ✓ / conferir ⚠ / provavelmente inexistente ✗"
 * ANTES de protocolar.
 *
 * Coberturas desta versão:
 * - Processo (nº CNJ): dígito verificador (ISO 7064 MOD 97-10). Uma citação
 *   inventada quase sempre falha o dígito → flagrada como inexistente.
 * - Súmula (STF/STJ/TST/Vinculante/TNU): faixa de numeração conhecida —
 *   "Súmula 9999" é pega na hora; números recentes viram "conferir".
 * - Lei/Decreto/EC: base local dos diplomas mais citados nas áreas atendidas;
 *   fora dela, "conferir na íntegra" (não afirmamos inexistência).
 *
 * Não substitui a leitura humana — confirma existência/estrutura, não o TEOR.
 * Verificação online (LexML para leis, DataJud para existência de processo)
 * fica como incremento seguinte.
 */

export type TipoCitacao = 'processo' | 'sumula' | 'lei'
export type StatusCitacao = 'verificada' | 'conferir' | 'nao_verificada'

export interface CitacaoVerificada {
  tipo: TipoCitacao
  texto: string
  status: StatusCitacao
  detalhe: string
}

export interface RelatorioCitacoes {
  itens: CitacaoVerificada[]
  total: number
  verificadas: number
  aConferir: number
  problemas: number
}

// ── Processo: dígito verificador CNJ (Resolução CNJ 65/2008) ──────────────────

/** Resto de um inteiro grande (como string de dígitos) mod 97, sem BigInt. */
function restoMod97(digitos: string): number {
  let r = 0
  for (let i = 0; i < digitos.length; i++) {
    r = (r * 10 + (digitos.charCodeAt(i) - 48)) % 97
  }
  return r
}

/**
 * Valida o dígito verificador de um número CNJ (formato
 * NNNNNNN-DD.AAAA.J.TR.OOOO), via ISO 7064 MOD 97-10. Determinístico e offline:
 * um número inventado tem ~96/97 de chance de falhar aqui.
 */
export function validarNumeroCNJ(numero: string): boolean {
  const d = numero.replace(/\D/g, '')
  if (d.length !== 20) return false
  const seq  = d.slice(0, 7)
  const dv   = d.slice(7, 9)
  const ano  = d.slice(9, 13)
  const jtr  = d.slice(13, 16)
  const orig = d.slice(16, 20)
  // Reposiciona o DV ao fim e verifica congruência ≡ 1 (mod 97).
  return restoMod97(seq + ano + jtr + orig + dv) === 1
}

const RE_PROCESSO_CNJ = /\b\d{7}-\d{2}\.\d{4}\.\d\.\d{2}\.\d{4}\b/g

// ── Súmula: faixa de numeração conhecida por tribunal ─────────────────────────

// Último número conhecido (aprox., jul/2026). Acima disso + margem → provável
// inexistência; dentro da margem → "conferir" (pode ser recente). Ajustável.
const SUMULA_MAX: Record<string, number> = {
  STF:        736,
  VINCULANTE: 59,
  STJ:        668,
  TST:        463,
  TNU:        100,
  TFR:        276,
}
const MARGEM_SUMULA = 30

const RE_SUMULA_VINCULANTE = /s[úu]mula\s+vinculante\s+(?:n[º°.]?\s*)?(\d{1,3})/gi
const RE_SUMULA_TRIBUNAL   = /s[úu]mula\s+(?:n[º°.]?\s*)?(\d{1,4})\s*(?:d[oae]s?\s+|\/)\s*(STF|STJ|TST|TNU|TFR)/gi

function verificarSumula(tribunal: string, numero: number): { status: StatusCitacao; detalhe: string } {
  const max = SUMULA_MAX[tribunal]
  if (!max) return { status: 'conferir', detalhe: `tribunal ${tribunal} sem faixa conhecida — confira` }
  if (numero <= 0) return { status: 'nao_verificada', detalhe: 'número inválido' }
  if (numero <= max) return { status: 'verificada', detalhe: `dentro da numeração conhecida do ${tribunal} (confira o teor)` }
  if (numero <= max + MARGEM_SUMULA) return { status: 'conferir', detalhe: `pouco acima do último nº conhecido do ${tribunal} — pode ser recente, confirme` }
  return { status: 'nao_verificada', detalhe: `muito acima do último nº conhecido do ${tribunal} (${max}) — provavelmente inexistente` }
}

// ── Lei/Decreto/EC: base local dos diplomas mais citados ──────────────────────

// Chave normalizada tipo-numero-ano dos diplomas frequentes nas áreas atendidas
// (previdenciário, trabalhista, cível, família, médico, consumidor, etc.).
const LEIS_CONHECIDAS: Record<string, string> = {
  'lei-10406-2002':    'Código Civil',
  'lei-13105-2015':    'Código de Processo Civil',
  'lei-8078-1990':     'Código de Defesa do Consumidor',
  'lei-5172-1966':     'Código Tributário Nacional',
  'decretolei-5452-1943': 'CLT',
  'decretolei-2848-1940': 'Código Penal',
  'decretolei-3689-1941': 'Código de Processo Penal',
  'decretolei-4657-1942': 'LINDB',
  'lei-8213-1991':     'Lei de Benefícios da Previdência',
  'lei-8212-1991':     'Lei de Custeio da Previdência',
  'lei-9717-1998':     'Normas de previdência do servidor',
  'emendaconstitucional-103-2019': 'Reforma da Previdência (EC 103)',
  'lei-9099-1995':     'Juizados Especiais',
  'lei-10259-2001':    'Juizados Especiais Federais',
  'lei-12016-2009':    'Mandado de Segurança',
  'lei-11340-2006':    'Lei Maria da Penha',
  'lei-10741-2003':    'Estatuto do Idoso',
  'lei-8069-1990':     'ECA',
  'lei-13146-2015':    'Estatuto da Pessoa com Deficiência',
  'lei-9656-1998':     'Lei dos Planos de Saúde',
  'lei-8080-1990':     'Lei do SUS',
  'lei-6015-1973':     'Lei de Registros Públicos',
  'lei-13709-2018':    'LGPD',
  'lei-6019-1974':     'Trabalho temporário',
  'lei-605-1949':      'Repouso semanal remunerado',
}

const RE_LEI = /(Lei\s+Complementar|Lei|Decreto-Lei|Decreto|Emenda\s+Constitucional)\s+(?:n[º°.]?\s*)?([\d.]+)\s*\/\s*(\d{2,4})/gi

function tipoLeiNormalizado(bruto: string): string {
  const t = bruto.toLowerCase()
  if (t.includes('complementar')) return 'leicomplementar'
  if (t.includes('emenda'))       return 'emendaconstitucional'
  if (t.includes('decreto-lei'))  return 'decretolei'
  if (t.includes('decreto'))      return 'decreto'
  return 'lei'
}

function anoCompleto(ano: string): string {
  if (ano.length === 4) return ano
  // 2 dígitos: heurística — 00–30 → 2000s, 31–99 → 1900s
  const n = parseInt(ano, 10)
  return (n <= 30 ? 2000 + n : 1900 + n).toString()
}

function verificarLei(tipoBruto: string, numeroBruto: string, anoBruto: string): { status: StatusCitacao; detalhe: string } {
  const tipo   = tipoLeiNormalizado(tipoBruto)
  const numero = numeroBruto.replace(/\./g, '')
  const ano    = anoCompleto(anoBruto)
  const chave  = `${tipo}-${numero}-${ano}`
  const nome   = LEIS_CONHECIDAS[chave]
  if (nome) return { status: 'verificada', detalhe: `${nome} — diploma conhecido` }
  return { status: 'conferir', detalhe: 'não consta da base local — confira número/ano/vigência na íntegra' }
}

// ── Orquestração ──────────────────────────────────────────────────────────────

/**
 * Extrai e verifica todas as citações de processo, súmula e lei de um texto.
 * Determinístico e síncrono — seguro para rodar no fluxo de validação da peça.
 */
export function verificarCitacoes(texto: string): RelatorioCitacoes {
  if (!texto) return { itens: [], total: 0, verificadas: 0, aConferir: 0, problemas: 0 }

  const itens: CitacaoVerificada[] = []
  const vistos = new Set<string>()

  const adicionar = (c: CitacaoVerificada) => {
    // Normaliza a chave para deduplicar variações de grafia da MESMA citação
    // (ex.: "Lei 8.213/1991" e "Lei nº 8.213/1991").
    const chave = `${c.tipo}:${c.texto.toLowerCase().replace(/n[º°.]\s*/g, '').replace(/\s+/g, ' ').trim()}`
    if (vistos.has(chave)) return
    vistos.add(chave)
    itens.push(c)
  }

  // Processos (nº CNJ)
  for (const m of texto.matchAll(RE_PROCESSO_CNJ)) {
    const texto0 = m[0]
    const valido = validarNumeroCNJ(texto0)
    adicionar({
      tipo: 'processo',
      texto: texto0,
      status: valido ? 'verificada' : 'nao_verificada',
      detalhe: valido
        ? 'nº CNJ com dígito verificador válido — confirme a existência e o teor'
        : 'dígito verificador NÃO confere — número de processo provavelmente inexistente/inventado',
    })
  }

  // Súmulas vinculantes
  for (const m of texto.matchAll(RE_SUMULA_VINCULANTE)) {
    const numero = parseInt(m[1], 10)
    const { status, detalhe } = verificarSumula('VINCULANTE', numero)
    adicionar({ tipo: 'sumula', texto: `Súmula Vinculante ${numero}`, status, detalhe })
  }

  // Súmulas por tribunal
  for (const m of texto.matchAll(RE_SUMULA_TRIBUNAL)) {
    const numero = parseInt(m[1], 10)
    const tribunal = m[2].toUpperCase()
    const { status, detalhe } = verificarSumula(tribunal, numero)
    adicionar({ tipo: 'sumula', texto: `Súmula ${numero} do ${tribunal}`, status, detalhe })
  }

  // Leis / Decretos / Emendas
  for (const m of texto.matchAll(RE_LEI)) {
    const { status, detalhe } = verificarLei(m[1], m[2], m[3])
    adicionar({ tipo: 'lei', texto: m[0].replace(/\s+/g, ' ').trim(), status, detalhe })
  }

  const verificadas = itens.filter((i) => i.status === 'verificada').length
  const aConferir   = itens.filter((i) => i.status === 'conferir').length
  const problemas   = itens.filter((i) => i.status === 'nao_verificada').length

  return { itens, total: itens.length, verificadas, aConferir, problemas }
}
