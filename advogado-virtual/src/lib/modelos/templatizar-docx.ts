import PizZip from 'pizzip'

// Transforma um .docx PREENCHIDO (exemplo do escritório) em TEMPLATE: substitui os
// valores variáveis (nome, CPF, endereço, objeto, data…) pelos {{placeholders}},
// PRESERVANDO a formatação original — inclusive quando o valor está dividido em vários
// runs do Word (problema clássico). Depois o preenchimento usa docxtemplater.

function decode(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
}

function encode(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

const RE_PARA = /<w:p\b[\s\S]*?<\/w:p>/g
const RE_T = /<w:t\b([^>]*)>([\s\S]*?)<\/w:t>/g

/** Texto do .docx como o motor o enxerga: parágrafos pela concatenação dos <w:t>.
 *  É ESTE texto que deve ser enviado à IA, para os `find` casarem exatamente. */
export function extrairTextoDocx(buffer: Buffer): string {
  const zip = new PizZip(buffer)
  const xml = zip.file('word/document.xml')?.asText() ?? ''
  const paras: string[] = []
  for (const p of xml.match(RE_PARA) ?? []) {
    let t = ''
    for (const mm of p.matchAll(RE_T)) t += decode(mm[2])
    if (t.trim()) paras.push(t)
  }
  return paras.join('\n\n')
}

export interface ParSubstituicao {
  find: string
  replace: string
}

/**
 * Substitui cada `find` por `replace` no texto do .docx, preservando a formatação
 * (mesmo com o texto dividido em vários runs). Retorna o novo buffer e quantas
 * substituições foram aplicadas.
 */
export function templatizarDocx(buffer: Buffer, pares: ParSubstituicao[]): { buffer: Buffer; aplicados: number } {
  const zip = new PizZip(buffer)
  const file = zip.file('word/document.xml')
  if (!file) throw new Error('Arquivo .docx inválido (sem word/document.xml)')

  // Ordena por tamanho desc — substitui valores mais longos primeiro (evita um valor
  // curto "comer" parte de um mais longo).
  const ordenados = [...pares].filter((p) => p.find).sort((a, b) => b.find.length - a.find.length)

  let total = 0
  const xml = file.asText().replace(RE_PARA, (par) => {
    const { novo, aplicados } = substituirNoParagrafo(par, ordenados)
    total += aplicados
    return novo
  })

  zip.file('word/document.xml', xml)
  return { buffer: zip.generate({ type: 'nodebuffer', compression: 'DEFLATE' }), aplicados: total }
}

function substituirNoParagrafo(par: string, pares: ParSubstituicao[]): { novo: string; aplicados: number } {
  const segs: { decoded: string }[] = []
  for (const mm of par.matchAll(RE_T)) segs.push({ decoded: decode(mm[2]) })
  if (!segs.length) return { novo: par, aplicados: 0 }

  let aplicados = 0
  for (const { find, replace } of pares) {
    let guard = 0
    while (guard++ < 100) {
      const lens = segs.map((s) => s.decoded.length)
      const full = segs.map((s) => s.decoded).join('')
      const a = full.indexOf(find)
      if (a < 0) break
      const b = a + find.length

      let pos = 0
      let inseriu = false
      for (let i = 0; i < segs.length; i++) {
        const segStart = pos
        const segEnd = segStart + lens[i]
        pos = segEnd
        if (segEnd <= a || segStart >= b) continue // run fora do trecho encontrado
        const localStart = Math.max(0, a - segStart)
        const localEnd = Math.min(lens[i], b - segStart)
        const dec = segs[i].decoded
        // 1º run sobreposto recebe o placeholder; os demais perdem o trecho coberto
        segs[i].decoded = dec.slice(0, localStart) + (inseriu ? '' : replace) + dec.slice(localEnd)
        inseriu = true
      }
      aplicados++
    }
  }

  // Reescreve os <w:t> com o novo texto (xml:space=preserve quando há espaço nas bordas)
  let k = 0
  const novo = par.replace(RE_T, (_m, attrs: string) => {
    const dec = segs[k++]?.decoded ?? ''
    const precisaPreserve = /^\s|\s$/.test(dec)
    const attrsOut = precisaPreserve && !/xml:space/.test(attrs) ? `${attrs} xml:space="preserve"` : attrs
    return `<w:t${attrsOut}>${encode(dec)}</w:t>`
  })

  return { novo, aplicados }
}
