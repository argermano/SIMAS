import {
  Document, Paragraph, TextRun,
  AlignmentType, convertMillimetersToTwip,
  Packer, TabStopPosition, TabStopType,
} from 'docx'

const FONT = 'Times New Roman'
const FONT_SIZE = 24 // 12pt (docx uses half-points)
const FONT_SIZE_EMENTA = 20 // 10pt para ementas
const COLOR_BLACK = '000000'
const LINE_SPACING = 360 // 1.5 line spacing
const INDENT_FIRST_LINE = convertMillimetersToTwip(12.5) // 1,25cm recuo ABNT

/**
 * Converte Markdown simples → DOCX com formatação jurídica forense
 */
export async function markdownToDocx(markdown: string, meta?: { titulo?: string; area?: string }): Promise<Buffer> {
  const lines = markdown.split('\n')
  const paragraphs: Paragraph[] = []

  let inBlockquote = false
  let blockquoteLines: string[] = []

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const trimmed = line.trim()

    // Blockquote (citação jurisprudência/doutrina)
    if (trimmed.startsWith('> ')) {
      inBlockquote = true
      blockquoteLines.push(trimmed.replace(/^>\s*/, ''))
      continue
    } else if (inBlockquote) {
      // Fim do blockquote
      const bqText = blockquoteLines.join(' ')
      paragraphs.push(new Paragraph({
        alignment: AlignmentType.JUSTIFIED,
        spacing: { before: 120, after: 120, line: 240 }, // Espaçamento simples
        indent: { left: convertMillimetersToTwip(40) }, // Recuo 4cm
        children: parseInlineFormatting(bqText, FONT_SIZE_EMENTA),
      }))
      inBlockquote = false
      blockquoteLines = []
    }

    if (!trimmed) {
      paragraphs.push(new Paragraph({ spacing: { after: 120 } }))
      continue
    }

    // Títulos H1 (nome da peça — centralizado, negrito, MAIÚSCULAS)
    if (trimmed.startsWith('# ') && !trimmed.startsWith('## ')) {
      const texto = trimmed.replace(/^#\s*/, '').replace(/\*\*/g, '')
      paragraphs.push(new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { before: 360, after: 240 },
        children: [new TextRun({
          text: texto.toUpperCase(),
          bold: true,
          size: FONT_SIZE,
          font: FONT,
          color: COLOR_BLACK,
        })],
      }))
      continue
    }

    // Títulos H2 (seções: I – DOS FATOS, II – DO DIREITO, etc.)
    if (trimmed.startsWith('## ')) {
      const texto = trimmed.replace(/^##\s*/, '').replace(/\*\*/g, '')
      paragraphs.push(new Paragraph({
        alignment: AlignmentType.LEFT,
        spacing: { before: 360, after: 200 },
        children: [new TextRun({
          text: texto,
          bold: true,
          size: FONT_SIZE,
          font: FONT,
          color: COLOR_BLACK,
        })],
      }))
      continue
    }

    // Títulos H3 (subseções: I.I – DA FRAUDE, etc.)
    if (trimmed.startsWith('### ')) {
      const texto = trimmed.replace(/^###\s*/, '').replace(/\*\*/g, '')
      paragraphs.push(new Paragraph({
        alignment: AlignmentType.LEFT,
        spacing: { before: 240, after: 160 },
        children: [new TextRun({
          text: texto,
          bold: true,
          size: FONT_SIZE,
          font: FONT,
          color: COLOR_BLACK,
        })],
      }))
      continue
    }

    // Itens de lista numerada (pedidos: I –, II –, etc.)
    if (/^[IVXLCDM]+[\.\s–\-]/.test(trimmed) || /^\d+\.\s/.test(trimmed)) {
      paragraphs.push(new Paragraph({
        alignment: AlignmentType.JUSTIFIED,
        spacing: { after: 80, line: LINE_SPACING },
        indent: { left: convertMillimetersToTwip(12.5) },
        children: parseInlineFormatting(trimmed, FONT_SIZE),
      }))
      continue
    }

    // Lista com marcador (- item)
    if (trimmed.startsWith('- ')) {
      const texto = trimmed.replace(/^-\s*/, '')
      paragraphs.push(new Paragraph({
        alignment: AlignmentType.JUSTIFIED,
        spacing: { after: 60, line: LINE_SPACING },
        indent: { left: convertMillimetersToTwip(12.5) },
        children: parseInlineFormatting(texto, FONT_SIZE),
      }))
      continue
    }

    // Parágrafo normal — justificado, recuo 1,25cm, espaçamento 1,5
    paragraphs.push(new Paragraph({
      alignment: AlignmentType.JUSTIFIED,
      spacing: { after: 120, line: LINE_SPACING },
      indent: { firstLine: INDENT_FIRST_LINE },
      children: parseInlineFormatting(trimmed, FONT_SIZE),
    }))
  }

  // Flush blockquote residual
  if (inBlockquote && blockquoteLines.length > 0) {
    const bqText = blockquoteLines.join(' ')
    paragraphs.push(new Paragraph({
      alignment: AlignmentType.JUSTIFIED,
      spacing: { before: 120, after: 120, line: 240 },
      indent: { left: convertMillimetersToTwip(40) },
      children: parseInlineFormatting(bqText, FONT_SIZE_EMENTA),
    }))
  }

  const doc = new Document({
    creator: 'SIMAS',
    title: meta?.titulo ?? 'Peça Processual',
    sections: [{
      properties: {
        page: {
          margin: {
            top: convertMillimetersToTwip(30),    // ABNT: 3cm
            bottom: convertMillimetersToTwip(20),  // ABNT: 2cm
            left: convertMillimetersToTwip(30),    // ABNT: 3cm
            right: convertMillimetersToTwip(20),   // ABNT: 2cm
          },
        },
      },
      children: paragraphs,
    }],
  })

  const buffer = await Packer.toBuffer(doc)
  return Buffer.from(buffer)
}

/**
 * Processa formatação inline: **negrito**, *itálico*, [PREENCHER], [VERIFICAR]
 */
function parseInlineFormatting(text: string, fontSize: number): TextRun[] {
  const runs: TextRun[] = []
  // Match **bold**, *italic*, [PREENCHER], [VERIFICAR]
  const parts = text.split(/(\*\*.*?\*\*|\*[^*]+?\*|\[PREENCHER\]|\[VERIFICAR\])/g)

  for (const part of parts) {
    if (!part) continue

    if (part === '[PREENCHER]') {
      runs.push(new TextRun({
        text: '[PREENCHER]',
        color: 'FF6600',
        bold: true,
        size: fontSize,
        font: FONT,
        highlight: 'yellow',
      }))
    } else if (part === '[VERIFICAR]') {
      runs.push(new TextRun({
        text: '[VERIFICAR]',
        color: 'CC0000',
        bold: true,
        size: fontSize,
        font: FONT,
        highlight: 'yellow',
      }))
    } else if (part.startsWith('**') && part.endsWith('**')) {
      runs.push(new TextRun({
        text: part.slice(2, -2),
        bold: true,
        size: fontSize,
        font: FONT,
        color: COLOR_BLACK,
      }))
    } else if (part.startsWith('*') && part.endsWith('*') && !part.startsWith('**')) {
      runs.push(new TextRun({
        text: part.slice(1, -1),
        italics: true,
        size: fontSize,
        font: FONT,
        color: COLOR_BLACK,
      }))
    } else {
      runs.push(new TextRun({
        text: part,
        size: fontSize,
        font: FONT,
        color: COLOR_BLACK,
      }))
    }
  }

  return runs
}
