import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { jsPDF } from 'jspdf'

// POST /api/contratos/[id]/exportar-pdf
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

  const buffer = markdownToPdf(contrato.conteudo_markdown)
  const titulo = (contrato.titulo ?? 'contrato').replace(/[^a-zA-Z0-9\s_\u00C0-\u017F-]/g, '').trim()

  return new NextResponse(buffer, {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${titulo}.pdf"`,
    },
  })
}

// ─── Markdown → PDF ──────────────────────────────────────────────────────────

function markdownToPdf(markdown: string): ArrayBuffer {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' })
  const pageWidth = 210
  const pageHeight = 297
  const margin = 20
  const usableWidth = pageWidth - 2 * margin
  const bottomLimit = pageHeight - margin
  let y = margin

  // jsPDF built-in fonts: helvetica, times, courier
  doc.setFont('times', 'normal')

  function checkPage(needed: number) {
    if (y + needed > bottomLimit) {
      doc.addPage()
      y = margin
    }
  }

  /**
   * Renders a line of text, handling inline **bold** segments.
   * Returns the total height used.
   */
  function renderTextWithBold(text: string, x: number, startY: number, fontSize: number, maxWidth: number): number {
    doc.setFontSize(fontSize)
    // Simple approach: strip bold markers, render plain text
    // For proper inline bold we'd need segment-by-segment rendering
    const clean = text.replace(/\*\*/g, '')
    const lines = doc.splitTextToSize(clean, maxWidth)
    const lineHeight = fontSize * 0.45
    for (let i = 0; i < lines.length; i++) {
      checkPage(lineHeight)
      doc.text(lines[i], x, y)
      y += lineHeight
    }
    return lines.length * lineHeight
  }

  /**
   * Renders a heading with bold, proper sizing, and optional centering.
   */
  function renderHeading(text: string, level: 1 | 2 | 3) {
    const sizes = { 1: 16, 2: 14, 3: 12 }
    const spaceBefore = { 1: 6, 2: 5, 3: 3 }
    const spaceAfter = { 1: 4, 2: 3, 3: 2 }
    const fontSize = sizes[level]

    y += spaceBefore[level]
    checkPage(fontSize * 0.5 + spaceAfter[level])

    doc.setFontSize(fontSize)
    doc.setFont('times', 'bold')
    const clean = text.replace(/\*\*/g, '')
    const lines = doc.splitTextToSize(clean, usableWidth)
    const lineHeight = fontSize * 0.45

    for (let i = 0; i < lines.length; i++) {
      checkPage(lineHeight)
      if (level === 1) {
        doc.text(lines[i], pageWidth / 2, y, { align: 'center' })
      } else {
        doc.text(lines[i], margin, y)
      }
      y += lineHeight
    }

    doc.setFont('times', 'normal')
    y += spaceAfter[level]
  }

  const lines = markdown.split('\n')

  for (const raw of lines) {
    const trimmed = raw.trim()

    if (trimmed === '') {
      y += 3
      continue
    }

    if (trimmed === '---') {
      checkPage(6)
      doc.setDrawColor(150)
      doc.line(margin, y, pageWidth - margin, y)
      y += 6
      continue
    }

    if (trimmed === '\\pagebreak' || trimmed === '[pagebreak]') {
      doc.addPage()
      y = margin
      continue
    }

    // H1
    if (trimmed.startsWith('# ') && !trimmed.startsWith('## ')) {
      renderHeading(trimmed.slice(2), 1)
      continue
    }
    // H2
    if (trimmed.startsWith('## ') && !trimmed.startsWith('### ')) {
      renderHeading(trimmed.slice(3), 2)
      continue
    }
    // H3
    if (trimmed.startsWith('### ')) {
      renderHeading(trimmed.slice(4), 3)
      continue
    }

    // Blockquote
    if (trimmed.startsWith('> ')) {
      doc.setFont('times', 'italic')
      renderTextWithBold(trimmed.slice(2), margin + 10, y, 12, usableWidth - 20)
      doc.setFont('times', 'normal')
      y += 1
      continue
    }

    // List item
    if (trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
      checkPage(5)
      doc.setFontSize(12)
      doc.text('\u2022', margin + 3, y)
      const saved = y
      renderTextWithBold(trimmed.slice(2), margin + 8, y, 12, usableWidth - 8)
      y += 1
      continue
    }

    // Normal paragraph
    doc.setFont('times', 'normal')
    renderTextWithBold(trimmed, margin, y, 12, usableWidth)
    y += 1
  }

  return doc.output('arraybuffer')
}
