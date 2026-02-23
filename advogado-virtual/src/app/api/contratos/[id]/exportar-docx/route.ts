import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import {
  Document, Packer, Paragraph, TextRun, HeadingLevel,
  AlignmentType, BorderStyle, PageBreak,
} from 'docx'

// ─── Converter markdown → parágrafos docx ───────────────────────────────────

function parseBoldRuns(text: string): TextRun[] {
  const runs: TextRun[] = []
  // Divide em partes: **negrito** e texto normal
  const parts = text.split(/(\*\*[^*]+\*\*)/)
  for (const part of parts) {
    if (part.startsWith('**') && part.endsWith('**')) {
      runs.push(new TextRun({ text: part.slice(2, -2), bold: true }))
    } else if (part) {
      runs.push(new TextRun({ text: part }))
    }
  }
  return runs.length > 0 ? runs : [new TextRun({ text: '' })]
}

function markdownToDocxParagraphs(markdown: string): Paragraph[] {
  const lines      = markdown.split('\n')
  const paragraphs: Paragraph[] = []

  for (let i = 0; i < lines.length; i++) {
    const raw     = lines[i]
    const trimmed = raw.trim()

    // Título H1
    if (trimmed.startsWith('# ')) {
      paragraphs.push(new Paragraph({
        text:     trimmed.slice(2),
        heading:  HeadingLevel.HEADING_1,
        alignment: AlignmentType.CENTER,
        spacing:  { before: 400, after: 200 },
      }))
      continue
    }

    // Título H2
    if (trimmed.startsWith('## ')) {
      paragraphs.push(new Paragraph({
        text:    trimmed.slice(3),
        heading: HeadingLevel.HEADING_2,
        spacing: { before: 320, after: 120 },
      }))
      continue
    }

    // Título H3
    if (trimmed.startsWith('### ')) {
      paragraphs.push(new Paragraph({
        text:    trimmed.slice(4),
        heading: HeadingLevel.HEADING_3,
        spacing: { before: 200, after: 80 },
      }))
      continue
    }

    // Separador horizontal ---
    if (trimmed === '---') {
      paragraphs.push(new Paragraph({
        border: {
          bottom: { style: BorderStyle.SINGLE, size: 6, color: '999999' },
        },
        spacing: { before: 80, after: 80 },
      }))
      continue
    }

    // Linha vazia → espaço
    if (trimmed === '') {
      paragraphs.push(new Paragraph({ spacing: { before: 80, after: 80 } }))
      continue
    }

    // Blockquote (> texto) → indentado
    if (trimmed.startsWith('> ')) {
      paragraphs.push(new Paragraph({
        children: parseBoldRuns(trimmed.slice(2)),
        indent:   { left: 720 },
        spacing:  { before: 80, after: 80 },
      }))
      continue
    }

    // Lista com hífen (- item)
    if (trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
      paragraphs.push(new Paragraph({
        children: [
          new TextRun({ text: '• ' }),
          ...parseBoldRuns(trimmed.slice(2)),
        ],
        indent:  { left: 360 },
        spacing: { before: 60, after: 60 },
      }))
      continue
    }

    // Quebra de página explícita
    if (trimmed === '\\pagebreak' || trimmed === '[pagebreak]') {
      paragraphs.push(new Paragraph({ children: [new PageBreak()] }))
      continue
    }

    // Texto comum (com possível negrito)
    paragraphs.push(new Paragraph({
      children: parseBoldRuns(trimmed),
      spacing:  { before: 80, after: 80 },
    }))
  }

  return paragraphs
}

// ─── Rota ───────────────────────────────────────────────────────────────────

// POST /api/contratos/[id]/exportar-docx
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })

  const { data: usuario } = await supabase
    .from('users')
    .select('id, tenant_id, role')
    .eq('auth_user_id', user.id)
    .single()

  if (!usuario) return NextResponse.json({ error: 'Usuário não encontrado' }, { status: 404 })

  if (!['admin', 'advogado'].includes(usuario.role)) {
    return NextResponse.json({ error: 'Sem permissão' }, { status: 403 })
  }

  const { data: contrato } = await supabase
    .from('contratos_honorarios')
    .select('titulo, conteudo_markdown, status')
    .eq('id', id)
    .eq('tenant_id', usuario.tenant_id)
    .single()

  if (!contrato) return NextResponse.json({ error: 'Contrato não encontrado' }, { status: 404 })
  if (!contrato.conteudo_markdown?.trim()) {
    return NextResponse.json({ error: 'Contrato sem conteúdo' }, { status: 400 })
  }

  // Marcar como exportado
  await supabase
    .from('contratos_honorarios')
    .update({ status: 'exportado' })
    .eq('id', id)

  // Gerar DOCX
  const doc = new Document({
    styles: {
      default: {
        document: {
          run: { font: 'Times New Roman', size: 24 }, // 12pt
        },
      },
    },
    sections: [{
      properties: {
        page: {
          margin: { top: 1134, right: 1134, bottom: 1134, left: 1134 }, // ~2cm
        },
      },
      children: markdownToDocxParagraphs(contrato.conteudo_markdown),
    }],
  })

  const buffer = await Packer.toBuffer(doc)
  const titulo  = (contrato.titulo ?? 'contrato').replace(/[^a-zA-Z0-9\s_-]/g, '').trim()

  return new NextResponse(buffer as unknown as BodyInit, {
    headers: {
      'Content-Type':        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'Content-Disposition': `attachment; filename="${titulo}.docx"`,
    },
  })
}
