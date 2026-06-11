import JSZip from 'jszip'
import type { EstiloDocumento } from '@/lib/format/estilo-documento'

/**
 * Extrai (de forma CONSERVADORA) os metadados de estilo de um arquivo .docx:
 * margens da seção, fonte/tamanho/entrelinha/recuo padrão do documento e
 * texto de cabeçalho/rodapé. Só retorna os campos confiavelmente encontrados —
 * o que faltar é preenchido depois pelo fallback (escritório > DEFAULT_ABNT).
 *
 * Um .docx é um ZIP de XMLs: word/document.xml (sectPr/pgMar),
 * word/styles.xml (w:docDefaults), word/header*.xml, word/footer*.xml.
 */

const TWIPS_POR_CM = 567 // 1 cm ≈ 567 twips (1 pol = 1440 twips = 2,54 cm)

function attr(xml: string, nome: string): string | undefined {
  const m = xml.match(new RegExp(`${nome}="([^"]*)"`))
  return m?.[1]
}

function twipsParaCm(v: string | undefined): number | undefined {
  if (v == null) return undefined
  const n = Number(v)
  if (!Number.isFinite(n)) return undefined
  return Math.round((n / TWIPS_POR_CM) * 100) / 100
}

/** Texto visível de um XML de header/footer (concatena os <w:t>). */
function textoDe(xml: string | undefined): string | undefined {
  if (!xml) return undefined
  const partes = [...xml.matchAll(/<w:t[^>]*>([\s\S]*?)<\/w:t>/g)].map((m) => m[1])
  const texto = partes.join(' ').replace(/\s+/g, ' ').trim()
  return texto ? texto.slice(0, 280) : undefined
}

export async function extrairEstiloDocx(buffer: Buffer): Promise<Partial<EstiloDocumento> | null> {
  let zip: JSZip
  try {
    zip = await JSZip.loadAsync(buffer)
  } catch {
    return null // não é um .docx válido
  }

  const documentXml = await zip.file('word/document.xml')?.async('string')
  if (!documentXml) return null

  const out: Partial<EstiloDocumento> = {}

  // ── Margens (w:pgMar dentro do sectPr) ──────────────────────────────
  const pgMar = documentXml.match(/<w:pgMar\b[^>]*\/?>/)?.[0]
  if (pgMar) {
    const topo = twipsParaCm(attr(pgMar, 'w:top'))
    const baixo = twipsParaCm(attr(pgMar, 'w:bottom'))
    const esquerda = twipsParaCm(attr(pgMar, 'w:left'))
    const direita = twipsParaCm(attr(pgMar, 'w:right'))
    if (topo != null && baixo != null && esquerda != null && direita != null) {
      out.margensCm = { topo, baixo, esquerda, direita }
    }
  }

  // ── Defaults do documento (w:docDefaults em styles.xml) ─────────────
  const stylesXml = await zip.file('word/styles.xml')?.async('string')
  const docDefaults = stylesXml?.match(/<w:docDefaults>[\s\S]*?<\/w:docDefaults>/)?.[0]
  if (docDefaults) {
    const rFonts = docDefaults.match(/<w:rFonts\b[^>]*>/)?.[0]
    const fonte = rFonts && attr(rFonts, 'w:ascii')
    if (fonte) out.fonte = fonte

    const sz = docDefaults.match(/<w:sz\b[^>]*>/)?.[0]
    const szVal = sz && attr(sz, 'w:val')
    if (szVal) {
      const pt = Number(szVal) / 2 // half-points → pt
      if (Number.isFinite(pt) && pt >= 6 && pt <= 24) out.tamanhoPt = pt
    }

    const spacing = docDefaults.match(/<w:spacing\b[^>]*>/)?.[0]
    if (spacing) {
      const lineRule = attr(spacing, 'w:lineRule')
      const line = attr(spacing, 'w:line')
      if (line && (lineRule === 'auto' || lineRule == null)) {
        const mult = Number(line) / 240 // 240 = simples
        if (Number.isFinite(mult) && mult >= 1 && mult <= 3) out.entrelinha = Math.round(mult * 100) / 100
      }
    }

    const ind = docDefaults.match(/<w:ind\b[^>]*>/)?.[0]
    const firstLine = ind && attr(ind, 'w:firstLine')
    const recuo = twipsParaCm(firstLine || undefined)
    if (recuo != null && recuo > 0 && recuo <= 5) out.recuoPrimeiraLinhaCm = recuo
  }

  // ── Cabeçalho / rodapé (primeiro arquivo com texto) ─────────────────
  for (const nome of Object.keys(zip.files)) {
    if (/^word\/header\d*\.xml$/.test(nome) && !out.cabecalho) {
      const t = textoDe(await zip.file(nome)?.async('string'))
      if (t) out.cabecalho = t
    }
    if (/^word\/footer\d*\.xml$/.test(nome) && !out.rodape) {
      const t = textoDe(await zip.file(nome)?.async('string'))
      if (t) out.rodape = t
    }
  }

  return Object.keys(out).length > 0 ? out : null
}
