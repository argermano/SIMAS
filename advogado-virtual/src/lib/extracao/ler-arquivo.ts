import { detectarTipoReal } from '@/lib/file-validation'

/**
 * Extrai texto de um arquivo (PDF, DOCX, TXT/MD) a partir do buffer.
 * Confere magic bytes antes de acionar parsers pesados. Mesmo comportamento da
 * rota /api/extrair-texto, centralizado para reuso (extração de teses etc.).
 */
export async function extrairTextoDeArquivo(
  buffer: Buffer,
  fileName: string,
  fileType?: string,
): Promise<{ texto: string; erro?: string }> {
  const nome = (fileName ?? '').toLowerCase()
  const isPdf = fileType === 'application/pdf' || nome.endsWith('.pdf')
  const isDocx = (fileType ?? '').includes('wordprocessingml') || nome.endsWith('.docx') || nome.endsWith('.doc')
  const isTxt = fileType === 'text/plain' || nome.endsWith('.txt') || nome.endsWith('.md')

  const tipoReal = detectarTipoReal(buffer)
  if (isPdf && tipoReal !== 'pdf') return { texto: '', erro: 'O arquivo não é um PDF válido' }
  if (isDocx && tipoReal !== 'zip') return { texto: '', erro: 'O arquivo não é um DOCX válido' }

  if (isPdf) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const pdfParse = require('pdf-parse/lib/pdf-parse.js') as (buf: Buffer) => Promise<{ text: string }>
      const d = await pdfParse(buffer)
      return { texto: d.text ?? '' }
    } catch (e) {
      return { texto: '', erro: `Erro ao ler PDF: ${e instanceof Error ? e.message : String(e)}` }
    }
  }

  if (isDocx) {
    try {
      const mammoth = await import('mammoth')
      const r = await mammoth.convertToHtml({ buffer })
      const texto = r.value
        .replace(/<\/p>/gi, '\n\n')
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<[^>]+>/g, '')
        .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
        .replace(/\n{3,}/g, '\n\n')
        .trim()
      return { texto }
    } catch (e) {
      return { texto: '', erro: `Erro ao ler DOCX: ${e instanceof Error ? e.message : String(e)}` }
    }
  }

  if (isTxt) return { texto: buffer.toString('utf-8') }
  return { texto: '', erro: `Formato não suportado: ${fileName}` }
}
