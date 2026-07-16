import { extractTextFromImage, extractTextFromPdf } from '@/lib/anthropic/client'

// Extração de texto a partir dos BYTES de um arquivo — mesma lógica dos fluxos de
// upload (PDF via pdf-parse com fallback OCR/visão do Claude; imagens via Claude;
// DOCX via mammoth; TXT direto). Server-only (usa parsers Node + SDK Anthropic).
// Retorna '' quando não há texto extraível (nunca lança). Não loga conteúdo.

const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'] as const

export async function extrairTextoDeArquivo(
  buffer: Buffer,
  mime: string | null | undefined,
  fileName: string,
): Promise<string> {
  const nome = (fileName ?? '').toLowerCase()
  const tipo = (mime ?? '').toLowerCase()

  const isPdf  = tipo === 'application/pdf' || nome.endsWith('.pdf')
  const isImg  = (IMAGE_TYPES as readonly string[]).includes(tipo)
  const isDocx = tipo === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    || tipo === 'application/msword' || nome.endsWith('.docx') || nome.endsWith('.doc')
  const isTxt  = tipo === 'text/plain' || nome.endsWith('.txt') || nome.endsWith('.md')

  if (isPdf) {
    let texto = ''
    try {
      // Importa a lib interna (evita o test runner do index.js do pdf-parse).
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const pdfParse = require('pdf-parse/lib/pdf-parse.js') as (buf: Buffer) => Promise<{ text: string }>
      const pdfData = await pdfParse(buffer)
      texto = pdfData.text ?? ''
      // Quase nada de texto = PDF escaneado (sem camada de texto) → força OCR.
      if (texto.replace(/\s+/g, '').length < 50) texto = ''
    } catch {
      texto = ''
    }
    if (!texto) {
      try {
        texto = await extractTextFromPdf({ pdfBase64: buffer.toString('base64') })
      } catch {
        texto = ''
      }
    }
    return texto.trim()
  }

  if (isImg) {
    try {
      const texto = await extractTextFromImage({
        imageBase64: buffer.toString('base64'),
        mediaType: tipo as 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp',
      })
      return texto.trim()
    } catch {
      return ''
    }
  }

  if (isDocx) {
    try {
      const mammoth = await import('mammoth')
      const result = await mammoth.convertToHtml({ buffer })
      return result.value
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
    } catch {
      return ''
    }
  }

  if (isTxt) {
    return new TextDecoder().decode(buffer).trim()
  }

  return ''
}
