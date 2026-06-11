import {
  Document, Paragraph, TextRun,
  AlignmentType, convertMillimetersToTwip,
  Packer,
} from 'docx'
import { type EstiloDocumento, resolverEstilo } from '@/lib/format/estilo-documento'

const COLOR_BLACK = '000000'

/** Valores do estilo já convertidos para as unidades do docx. */
interface EstiloDocx {
  font: string
  size: number          // half-points
  sizeEmenta: number    // half-points
  lineSpacing: number   // 240 = simples
  indentFirstLine: number
  indentBlockquote: number
  margins: { top: number; bottom: number; left: number; right: number }
}

function estiloParaDocx(estilo: EstiloDocumento): EstiloDocx {
  const cm = (v: number) => convertMillimetersToTwip(v * 10)
  return {
    font: estilo.fonte,
    size: Math.round(estilo.tamanhoPt * 2),
    sizeEmenta: Math.round(estilo.tamanhoEmentaPt * 2),
    lineSpacing: Math.round(240 * estilo.entrelinha),
    indentFirstLine: cm(estilo.recuoPrimeiraLinhaCm),
    indentBlockquote: cm(estilo.recuoBlockquoteCm),
    margins: {
      top: cm(estilo.margensCm.topo),
      bottom: cm(estilo.margensCm.baixo),
      left: cm(estilo.margensCm.esquerda),
      right: cm(estilo.margensCm.direita),
    },
  }
}

interface DocxOptions {
  titulo?: string
  area?: string
  /** Estilo de apresentação; default = ABNT/forense. */
  estilo?: Partial<EstiloDocumento> | null
}

/**
 * Converte Markdown → DOCX aplicando o EstiloDocumento informado
 * (fonte, corpo, entrelinha, recuo, margens). Sem `estilo`, usa o DEFAULT_ABNT.
 */
export async function markdownToDocx(markdown: string, opts?: DocxOptions): Promise<Buffer> {
  const e = estiloParaDocx(resolverEstilo(opts?.estilo))
  const lines = markdown.split('\n')
  const paragraphs: Paragraph[] = []

  let inBlockquote = false
  let blockquoteLines: string[] = []

  const flushBlockquote = () => {
    const bqText = blockquoteLines.join(' ')
    paragraphs.push(new Paragraph({
      alignment: AlignmentType.JUSTIFIED,
      spacing: { before: 120, after: 120, line: 240 },
      indent: { left: e.indentBlockquote },
      children: parseInlineFormatting(bqText, e.sizeEmenta, e.font),
    }))
    inBlockquote = false
    blockquoteLines = []
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const trimmed = line.trim()

    // Blockquote (citação jurisprudência/doutrina)
    if (trimmed.startsWith('> ')) {
      inBlockquote = true
      blockquoteLines.push(trimmed.replace(/^>\s*/, ''))
      continue
    } else if (inBlockquote) {
      flushBlockquote()
    }

    if (!trimmed) {
      paragraphs.push(new Paragraph({ spacing: { after: 120 } }))
      continue
    }

    // Título H1 (nome da peça — centralizado, negrito, MAIÚSCULAS)
    if (trimmed.startsWith('# ') && !trimmed.startsWith('## ')) {
      const texto = trimmed.replace(/^#\s*/, '').replace(/\*\*/g, '')
      paragraphs.push(new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { before: 360, after: 240 },
        children: [new TextRun({ text: texto.toUpperCase(), bold: true, size: e.size, font: e.font, color: COLOR_BLACK })],
      }))
      continue
    }

    // Títulos H2 (seções) e H3 (subseções) — esquerda, negrito
    if (trimmed.startsWith('## ')) {
      const texto = trimmed.replace(/^##\s*/, '').replace(/\*\*/g, '')
      paragraphs.push(new Paragraph({
        alignment: AlignmentType.LEFT,
        spacing: { before: 360, after: 200 },
        children: [new TextRun({ text: texto, bold: true, size: e.size, font: e.font, color: COLOR_BLACK })],
      }))
      continue
    }
    if (trimmed.startsWith('### ')) {
      const texto = trimmed.replace(/^###\s*/, '').replace(/\*\*/g, '')
      paragraphs.push(new Paragraph({
        alignment: AlignmentType.LEFT,
        spacing: { before: 240, after: 160 },
        children: [new TextRun({ text: texto, bold: true, size: e.size, font: e.font, color: COLOR_BLACK })],
      }))
      continue
    }

    // Itens de lista (pedidos: I –, II –, etc.) ou numeração arábica
    if (/^[IVXLCDM]+[\.\s–\-]/.test(trimmed) || /^\d+\.\s/.test(trimmed)) {
      paragraphs.push(new Paragraph({
        alignment: AlignmentType.JUSTIFIED,
        spacing: { after: 80, line: e.lineSpacing },
        indent: { left: e.indentFirstLine },
        children: parseInlineFormatting(trimmed, e.size, e.font),
      }))
      continue
    }

    // Lista com marcador (- item)
    if (trimmed.startsWith('- ')) {
      const texto = trimmed.replace(/^-\s*/, '')
      paragraphs.push(new Paragraph({
        alignment: AlignmentType.JUSTIFIED,
        spacing: { after: 60, line: e.lineSpacing },
        indent: { left: e.indentFirstLine },
        children: parseInlineFormatting(texto, e.size, e.font),
      }))
      continue
    }

    // Parágrafo normal — justificado, recuo de 1ª linha, entrelinha do estilo
    paragraphs.push(new Paragraph({
      alignment: AlignmentType.JUSTIFIED,
      spacing: { after: 120, line: e.lineSpacing },
      indent: { firstLine: e.indentFirstLine },
      children: parseInlineFormatting(trimmed, e.size, e.font),
    }))
  }

  // Flush blockquote residual
  if (inBlockquote && blockquoteLines.length > 0) flushBlockquote()

  const doc = new Document({
    creator: 'SIMAS',
    title: opts?.titulo ?? 'Peça Processual',
    sections: [{
      properties: { page: { margin: e.margins } },
      children: paragraphs,
    }],
  })

  const buffer = await Packer.toBuffer(doc)
  return Buffer.from(buffer)
}

/**
 * Processa formatação inline: **negrito**, *itálico*, [PREENCHER], [VERIFICAR]
 */
function parseInlineFormatting(text: string, fontSize: number, font: string): TextRun[] {
  const runs: TextRun[] = []
  const parts = text.split(/(\*\*.*?\*\*|\*[^*]+?\*|\[PREENCHER\]|\[VERIFICAR\])/g)

  for (const part of parts) {
    if (!part) continue

    if (part === '[PREENCHER]') {
      runs.push(new TextRun({ text: '[PREENCHER]', color: 'FF6600', bold: true, size: fontSize, font, highlight: 'yellow' }))
    } else if (part === '[VERIFICAR]') {
      runs.push(new TextRun({ text: '[VERIFICAR]', color: 'CC0000', bold: true, size: fontSize, font, highlight: 'yellow' }))
    } else if (part.startsWith('**') && part.endsWith('**')) {
      runs.push(new TextRun({ text: part.slice(2, -2), bold: true, size: fontSize, font, color: COLOR_BLACK }))
    } else if (part.startsWith('*') && part.endsWith('*') && !part.startsWith('**')) {
      runs.push(new TextRun({ text: part.slice(1, -1), italics: true, size: fontSize, font, color: COLOR_BLACK }))
    } else {
      runs.push(new TextRun({ text: part, size: fontSize, font, color: COLOR_BLACK }))
    }
  }

  return runs
}
