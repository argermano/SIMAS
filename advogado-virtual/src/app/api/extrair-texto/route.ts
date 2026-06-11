import { NextResponse } from 'next/server'
import { getAuthContext } from '@/lib/auth'
import { jsonError } from '@/lib/api'
import { detectarTipoReal } from '@/lib/file-validation'

export const maxDuration = 60

const MAX_FILE_SIZE = 25 * 1024 * 1024 // 25 MB — evita hang/exhaust no pdf-parse

// POST /api/extrair-texto — extrai texto de arquivo (PDF, DOCX, TXT)
export async function POST(req: Request) {
  const auth = await getAuthContext()
  if (!auth.ok) return auth.response

  const formData = await req.formData()
  const file = formData.get('file') as File | null
  if (!file) return jsonError('Arquivo não enviado', 400)

  if (file.size > MAX_FILE_SIZE) {
    return jsonError('Arquivo excede o limite de 25 MB', 413)
  }

  const arrayBuffer = await file.arrayBuffer()
  const buffer = Buffer.from(arrayBuffer)
  let texto = ''
  let erro = ''

  const isPdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')
  const isDocx = file.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
    file.name.toLowerCase().endsWith('.docx') || file.name.toLowerCase().endsWith('.doc')
  const isTxt = file.type === 'text/plain' || file.name.toLowerCase().endsWith('.txt') || file.name.toLowerCase().endsWith('.md')

  // Confere magic bytes para PDF/DOCX antes de passar a parsers pesados
  const tipoReal = detectarTipoReal(buffer)
  if (isPdf && tipoReal !== 'pdf') {
    return jsonError('O arquivo não é um PDF válido', 400)
  }
  if (isDocx && tipoReal !== 'zip') {
    return jsonError('O arquivo não é um DOCX válido', 400)
  }

  if (isPdf) {
    try {
      // Importa lib interna para evitar o test runner do index.js
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const pdfParse = require('pdf-parse/lib/pdf-parse.js') as (buf: Buffer) => Promise<{ text: string }>
      const pdfData = await pdfParse(buffer)
      texto = pdfData.text ?? ''
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
