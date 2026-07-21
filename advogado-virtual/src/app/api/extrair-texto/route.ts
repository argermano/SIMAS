import { NextResponse } from 'next/server'
import { getAuthContext } from '@/lib/auth'
import { jsonError } from '@/lib/api'
import { detectarTipoReal } from '@/lib/file-validation'
import { extrairTexto, MAX_EXTRACT_BYTES } from '@/lib/documentos/extrair-texto'

export const maxDuration = 60

// POST /api/extrair-texto — extrai texto de arquivo (PDF, DOCX, TXT)
export async function POST(req: Request) {
  const auth = await getAuthContext()
  if (!auth.ok) return auth.response

  const formData = await req.formData()
  const file = formData.get('file') as File | null
  if (!file) return jsonError('Arquivo não enviado', 400)

  // Barra o arquivo antes de ler os bytes na memória (teto único de extração).
  if (file.size > MAX_EXTRACT_BYTES) {
    return jsonError(`Arquivo excede o limite de ${Math.round(MAX_EXTRACT_BYTES / (1024 * 1024))} MB`, 413)
  }

  const buffer = Buffer.from(await file.arrayBuffer())

  const isPdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')
  const isDocx = file.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
    file.name.toLowerCase().endsWith('.docx') || file.name.toLowerCase().endsWith('.doc')

  // Confere magic bytes para PDF/DOCX antes de passar a parsers pesados
  const tipoReal = detectarTipoReal(buffer)
  if (isPdf && tipoReal !== 'pdf') {
    return jsonError('O arquivo não é um PDF válido', 400)
  }
  if (isDocx && tipoReal !== 'zip') {
    return jsonError('O arquivo não é um DOCX válido', 400)
  }

  const { texto, erro } = await extrairTexto(buffer, {
    mime:     file.type,
    fileName: file.name,
    maxBytes: MAX_EXTRACT_BYTES,
    docx:     'html',
  })

  return NextResponse.json({ texto, erro: erro || undefined })
}
