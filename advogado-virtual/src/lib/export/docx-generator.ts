import {
  Document, Paragraph, TextRun, HeadingLevel,
  AlignmentType, convertMillimetersToTwip,
  Packer,
} from 'docx'

/**
 * Converte Markdown simples → DOCX com formatação jurídica
 */
export async function markdownToDocx(markdown: string, meta?: { titulo?: string; area?: string }): Promise<Buffer> {
  const lines = markdown.split('\n')
  const paragraphs: Paragraph[] = []

  for (const line of lines) {
    const trimmed = line.trim()

    if (!trimmed) {
      paragraphs.push(new Paragraph({ spacing: { after: 120 } }))
      continue
    }

    // Títulos
    if (trimmed.startsWith('# ')) {
      paragraphs.push(new Paragraph({
        heading: HeadingLevel.HEADING_1,
        alignment: AlignmentType.CENTER,
        spacing: { before: 240, after: 120 },
        children: [new TextRun({ text: trimmed.replace(/^#+\s*/, ''), bold: true, size: 28, font: 'Times New Roman' })],
      }))
      continue
    }

    if (trimmed.startsWith('## ')) {
      paragraphs.push(new Paragraph({
        heading: HeadingLevel.HEADING_2,
        spacing: { before: 240, after: 120 },
        children: [new TextRun({ text: trimmed.replace(/^#+\s*/, ''), bold: true, size: 26, font: 'Times New Roman' })],
      }))
      continue
    }

    if (trimmed.startsWith('### ')) {
      paragraphs.push(new Paragraph({
        heading: HeadingLevel.HEADING_3,
        spacing: { before: 200, after: 80 },
        children: [new TextRun({ text: trimmed.replace(/^#+\s*/, ''), bold: true, size: 24, font: 'Times New Roman' })],
      }))
      continue
    }

    // Itens de lista
    if (/^\d+\.\s/.test(trimmed) || trimmed.startsWith('- ')) {
      const texto = trimmed.replace(/^(\d+\.|-)\s*/, '')
      paragraphs.push(new Paragraph({
        spacing: { after: 60 },
        indent: { left: convertMillimetersToTwip(10) },
        children: parseInlineFormatting(texto),
      }))
      continue
    }

    // Parágrafo normal
    paragraphs.push(new Paragraph({
      alignment: AlignmentType.JUSTIFIED,
      spacing: { after: 120, line: 360 }, // Espaçamento 1.5
      indent: { firstLine: convertMillimetersToTwip(12.7) }, // Recuo padrão ABNT
      children: parseInlineFormatting(trimmed),
    }))
  }

  const doc = new Document({
    creator: 'Advogado Virtual',
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

function parseInlineFormatting(text: string): TextRun[] {
  const runs: TextRun[] = []
  const parts = text.split(/(\*\*.*?\*\*|\[PREENCHER\]|\[VERIFICAR\])/g)

  for (const part of parts) {
    if (!part) continue

    if (part === '[PREENCHER]') {
      runs.push(new TextRun({
        text: '[PREENCHER]',
        color: 'FF6600',
        bold: true,
        size: 24,
        font: 'Times New Roman',
        highlight: 'yellow',
      }))
    } else if (part === '[VERIFICAR]') {
      runs.push(new TextRun({
        text: '[VERIFICAR]',
        color: 'CC0000',
        bold: true,
        size: 24,
        font: 'Times New Roman',
        highlight: 'yellow',
      }))
    } else if (part.startsWith('**') && part.endsWith('**')) {
      runs.push(new TextRun({
        text: part.slice(2, -2),
        bold: true,
        size: 24,
        font: 'Times New Roman',
      }))
    } else {
      runs.push(new TextRun({
        text: part,
        size: 24,
        font: 'Times New Roman',
      }))
    }
  }

  return runs
}
