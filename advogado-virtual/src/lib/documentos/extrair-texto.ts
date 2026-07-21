import { extractTextFromImage, extractTextFromPdf } from '@/lib/anthropic/client'
import { detectarTipoReal } from '@/lib/file-validation'

// Extração de texto a partir dos BYTES de um arquivo — ponto único usado por todas
// as rotas de upload/extração (antes o mesmo bloco require('pdf-parse') + mammoth
// estava copiado em 5 rotas com tetos divergentes; uma sem teto algum).
//
// Server-only (usa parsers Node + SDK Anthropic). Nunca lança: retorna { texto: '' }
// (com `erro` quando aplicável) em qualquer falha. Não loga conteúdo (LGPD).

// Teto único de extração: 50 MB era o maior teto já em produção (upload de documentos
// de atendimento). Uniformiza o limite e evita hang/exhaust no pdf-parse (pacote
// abandonado desde 2018) nas funções da Vercel Hobby.
export const MAX_EXTRACT_BYTES = 50 * 1024 * 1024

const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'] as const

export type DocxModo = 'html' | 'raw'

export interface ExtrairTextoOpts {
  /** MIME declarado do arquivo (usado, junto do nome, para escolher o parser). */
  mime?: string | null
  /** Nome do arquivo — usado como fallback do MIME para detectar a extensão. */
  fileName?: string
  /** Teto de bytes; acima disso a extração é pulada com `erro`. Default 50 MB. */
  maxBytes?: number
  /** PDF sem camada de texto / imagens → fallback para a visão do Claude. Default false. */
  ocr?: boolean
  /** DOCX: 'html' (parágrafos preservados via convertToHtml) ou 'raw' (extractRawText). Default 'html'. */
  docx?: DocxModo
  /** Confere os magic bytes (assinatura real) de PDF/DOCX antes dos parsers pesados. */
  validarTipo?: boolean
  /** Tipo desconhecido → decodifica como texto puro (UTF-8) em vez de retornar `erro`. Default false. */
  fallbackTxt?: boolean
}

export interface ExtrairTextoResult {
  texto: string
  erro?: string
}

async function lerPdf(buffer: Buffer, ocr: boolean): Promise<string> {
  let texto = ''
  try {
    // Importa a lib interna (evita o self-test do index.js do pdf-parse — bug conhecido).
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const pdfParse = require('pdf-parse/lib/pdf-parse.js') as (buf: Buffer) => Promise<{ text: string }>
    const pdfData = await pdfParse(buffer)
    texto = pdfData.text ?? ''
  } catch {
    texto = ''
  }
  // Quase nada de texto = PDF escaneado (sem camada de texto) → força OCR/visão do Claude.
  if (ocr && texto.replace(/\s+/g, '').length < 50) {
    try {
      texto = await extractTextFromPdf({ pdfBase64: buffer.toString('base64') })
    } catch {
      texto = ''
    }
  }
  return texto.trim()
}

async function lerImagem(buffer: Buffer, tipo: string): Promise<string> {
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

async function lerDocx(buffer: Buffer, modo: DocxModo): Promise<string> {
  try {
    const mammoth = await import('mammoth')
    if (modo === 'raw') {
      const result = await mammoth.extractRawText({ buffer })
      return (result.value ?? '').trim()
    }
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

export async function extrairTexto(
  buffer: Buffer,
  opts: ExtrairTextoOpts = {},
): Promise<ExtrairTextoResult> {
  const {
    mime,
    fileName = '',
    maxBytes = MAX_EXTRACT_BYTES,
    ocr = false,
    docx = 'html',
    validarTipo = false,
    fallbackTxt = false,
  } = opts

  if (maxBytes && buffer.byteLength > maxBytes) {
    return { texto: '', erro: `Arquivo excede o limite de ${Math.round(maxBytes / (1024 * 1024))} MB` }
  }

  const nome = fileName.toLowerCase()
  const tipo = (mime ?? '').toLowerCase()

  const isPdf = tipo === 'application/pdf' || nome.endsWith('.pdf')
  const isImg = (IMAGE_TYPES as readonly string[]).includes(tipo)
  const isDocx = tipo === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    || tipo === 'application/msword' || nome.endsWith('.docx') || nome.endsWith('.doc')
  const isTxt = tipo === 'text/plain' || nome.endsWith('.txt') || nome.endsWith('.md')

  if (validarTipo) {
    const tipoReal = detectarTipoReal(buffer)
    if (isPdf && tipoReal !== 'pdf') return { texto: '', erro: 'O arquivo não é um PDF válido' }
    if (isDocx && tipoReal !== 'zip') return { texto: '', erro: 'O arquivo não é um DOCX válido' }
  }

  if (isPdf) return { texto: await lerPdf(buffer, ocr) }
  if (isImg && ocr) return { texto: await lerImagem(buffer, tipo) }
  if (isDocx) return { texto: await lerDocx(buffer, docx) }
  if (isTxt || fallbackTxt) return { texto: new TextDecoder().decode(buffer).trim() }

  return { texto: '', erro: `Formato não suportado: ${fileName || mime || 'desconhecido'}` }
}

/**
 * Compat: assinatura antiga (retorna só o texto) usada pela rota
 * documentos/[docId]/extrair. Fluxo de OCR — PDF com fallback para o Claude,
 * imagens via Claude, DOCX em HTML, TXT direto.
 */
export async function extrairTextoDeArquivo(
  buffer: Buffer,
  mime: string | null | undefined,
  fileName: string,
): Promise<string> {
  const { texto } = await extrairTexto(buffer, { mime, fileName, ocr: true, docx: 'html' })
  return texto
}
