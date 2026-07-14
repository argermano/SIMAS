// Allowlist de tipos aceitos ao enviar anexo ao cliente (anti-abuso), compartilhada
// pelas três rotas de anexo (upload do PC, encaminhar, anexar documento do SIMAS).
// Alinhada com /api/conversas/anexos (render inline) + docs comuns de escritório.
// Nunca aceitar SVG/HTML (script embutido) nem tipos executáveis.

export const TIPOS_ANEXO_PERMITIDOS = new Set<string>([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'application/pdf',
  'application/msword',                                                          // .doc
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',     // .docx
  'application/vnd.ms-excel',                                                    // .xls
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',           // .xlsx
  'text/plain',
])

// Limite do upload direto do PC: o corpo da função Vercel é ~4.5 MB, deixamos margem.
// Encaminhar / anexar documento do SIMAS não passam por aqui (bytes são server-side).
export const LIMITE_UPLOAD_BYTES = 4 * 1024 * 1024

// Teto para anexos buferizados SERVER-SIDE (encaminhar / documento do SIMAS): não
// passam pelo limite de body da Vercel, mas precisam de um teto para não estourar
// a memória/timeout da função com PDFs escaneados enormes (40-80 MB são comuns).
export const LIMITE_ANEXO_SERVIDOR_BYTES = 25 * 1024 * 1024

// Legenda (WhatsApp aceita ~1024 chars): teto compartilhado pelas rotas de anexo.
export const LIMITE_CAPTION_CHARS = 1024

// Mapa extensão -> MIME da allowlist (fallback quando o navegador/relay não informa
// um Content-Type útil: alguns SOs dão File.type '' para .doc/.docx e o Chatwoot
// guarda docs como application/octet-stream).
const MIME_POR_EXTENSAO: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  gif: 'image/gif',
  pdf: 'application/pdf',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  txt: 'text/plain',
}

/** Normaliza um Content-Type ("image/png; charset=x") para o tipo base minúsculo. */
export function tipoBase(contentType: string | null | undefined): string {
  return (contentType ?? '').split(';')[0].trim().toLowerCase()
}

/** True se o Content-Type (com ou sem params) estiver na allowlist. */
export function tipoAnexoPermitido(contentType: string | null | undefined): boolean {
  return TIPOS_ANEXO_PERMITIDOS.has(tipoBase(contentType))
}

/** MIME da allowlist deduzido pela extensão do nome ('' se desconhecida). */
export function mimePorNomeArquivo(nome: string | null | undefined): string {
  const ext = (nome ?? '').split('.').pop()?.toLowerCase() ?? ''
  return MIME_POR_EXTENSAO[ext] ?? ''
}

/** Extensão canônica (com ponto) para um MIME da allowlist ('' se desconhecido). */
export function extensaoPorMime(contentType: string | null | undefined): string {
  const base = tipoBase(contentType)
  for (const [ext, mime] of Object.entries(MIME_POR_EXTENSAO)) {
    if (mime === base) return `.${ext}`
  }
  return ''
}
