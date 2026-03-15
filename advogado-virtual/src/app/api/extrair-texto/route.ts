import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

export const maxDuration = 60

// POST /api/extrair-texto — extrai texto de arquivo (PDF, DOCX, TXT)
export async function POST(req: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })

  const formData = await req.formData()
  const file = formData.get('file') as File | null
  if (!file) return NextResponse.json({ error: 'Arquivo não enviado' }, { status: 400 })

  const arrayBuffer = await file.arrayBuffer()
  const buffer = Buffer.from(arrayBuffer)
  let texto = ''
  let erro = ''

  const isPdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')
  const isDocx = file.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
    file.name.toLowerCase().endsWith('.docx') || file.name.toLowerCase().endsWith('.doc')
  const isTxt = file.type === 'text/plain' || file.name.toLowerCase().endsWith('.txt') || file.name.toLowerCase().endsWith('.md')

  if (isPdf) {
    try {
      const { PDFParse } = await import('pdf-parse')
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const parser = new PDFParse(new Uint8Array(buffer)) as any
      await parser.load()
      const result = await parser.getText()
      texto = (result as { pages: Array<{ text: string }> }).pages
        .map((p: { text: string }) => p.text)
        .join('\n\n')
        .trim()
    } catch (err) {
      console.error('[extrair-texto] Erro ao processar PDF:', err)
      erro = `Erro ao processar PDF: ${err instanceof Error ? err.message : String(err)}`
    }
  } else if (isDocx) {
    try {
      const mammoth = await import('mammoth')
      const result = await mammoth.convertToHtml({ buffer })
      texto = result.value
        .replace(/<\/p>/gi, '\n\n')
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<[^>]+>/g, '')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/\n{3,}/g, '\n\n')
        .trim()
    } catch (err) {
      console.error('[extrair-texto] Erro ao processar DOCX:', err)
      erro = `Erro ao processar DOCX: ${err instanceof Error ? err.message : String(err)}`
    }
  } else if (isTxt) {
    texto = new TextDecoder().decode(arrayBuffer)
  } else {
    erro = `Formato não suportado: ${file.type} (${file.name})`
  }

  return NextResponse.json({ texto, erro: erro || undefined })
}
