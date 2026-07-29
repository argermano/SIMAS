// Allowlist de tipos aceitos ao enviar anexo ao cliente (anti-abuso), compartilhada
// pelas três rotas de anexo (upload do PC, encaminhar, anexar documento do SIMAS).
// Alinhada com /api/conversas/anexos (render inline) + docs comuns de escritório.
// Nunca aceitar SVG/HTML (script embutido) nem tipos executáveis.
//
// MÍDIA (áudio/vídeo) entra por REGRA, não por lista (ver ehMidiaInerte): o caso
// real do dono era não conseguir encaminhar um vídeo recebido no grupo. O conjunto
// abaixo segue sendo a lista de DOCUMENTOS/IMAGENS (é ele que a rota
// /api/conversas/documentos usa para filtrar o dossiê por mime_type).

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

// Limite do upload do PC (produto). O arquivo sobe DIRETO ao Storage por URL
// assinada (fluxo preparar → uploadToSignedUrl), então NÃO passa mais pelo corpo
// da função Vercel (~4,5 MB). O teto de 40 MB NÃO é arbitrário: é o limite de
// anexo do CHATWOOT (validação interna dele, próximo elo relay→Chatwoot) — acima
// disso o upload passaria e o ENVIO falharia depois. Subir além de 40 MB exige
// patch no Chatwoot do VPS. Deve ser <= LIMITE_ANEXO_SERVIDOR_BYTES para o passo
// server-side nunca recusar um arquivo que o cliente já aceitou.
export const LIMITE_UPLOAD_BYTES = 40 * 1024 * 1024

// Teto para anexos buferizados SERVER-SIDE (baixar do Storage p/ relay: envio do
// PC, encaminhar, documento do SIMAS): não sofrem o limite de body da Vercel, mas
// precisam de um teto para não estourar a memória/timeout da função. Fica ACIMA
// de LIMITE_UPLOAD_BYTES (40 MB) como folga/anti-abuso: o caminho legítimo já
// barrou 40 MB no preparar; este só pega bytes que excedem o tamanho declarado
// na URL assinada.
export const LIMITE_ANEXO_SERVIDOR_BYTES = 45 * 1024 * 1024

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
  // Mídia do WhatsApp (vídeo/áudio recebido que se quer encaminhar, e também o
  // upload do PC). O Chatwoot guarda muita mídia como application/octet-stream —
  // sem estas extensões o fallback por nome não salvava o encaminhamento.
  // Ordem importa para extensaoPorMime: a 1ª extensão de cada MIME é a canônica
  // (ogg antes de opus).
  mp4: 'video/mp4',
  '3gp': 'video/3gpp',
  mov: 'video/quicktime',
  ogg: 'audio/ogg',
  opus: 'audio/ogg',
  mp3: 'audio/mpeg',
  m4a: 'audio/mp4',
}

/** Normaliza um Content-Type ("image/png; charset=x") para o tipo base minúsculo. */
export function tipoBase(contentType: string | null | undefined): string {
  return (contentType ?? '').split(';')[0].trim().toLowerCase()
}

/**
 * Áudio/vídeo: mídia INERTE (não executa script), aceita por REGRA de prefixo em
 * vez de lista fechada — o zoo de codecs do WhatsApp é grande demais para
 * enumerar ("audio/ogg; codecs=opus", audio/x-m4a, audio/webm, video/quicktime…)
 * e uma lista curta recusava vídeo legítimo. Mesmo raciocínio (e mesma conclusão)
 * do proxy GET /api/conversas/anexos, que já serve esses tipos inline.
 */
export function ehMidiaInerte(contentType: string | null | undefined): boolean {
  const base = tipoBase(contentType)
  return base.startsWith('audio/') || base.startsWith('video/')
}

/** True se o Content-Type (com ou sem params) estiver na allowlist (docs/imagens
 *  enumerados) OU for mídia inerte (áudio/vídeo). */
export function tipoAnexoPermitido(contentType: string | null | undefined): boolean {
  const base = tipoBase(contentType)
  return TIPOS_ANEXO_PERMITIDOS.has(base) || ehMidiaInerte(base)
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

// --- Upload direto ao Storage (envio de anexo do PC ao cliente) ---------------
// O arquivo sobe por URL assinada para uma área temporária do bucket `documentos`;
// depois o servidor baixa os bytes, repassa ao relay e apaga o objeto.

/** Sanitiza o nome do arquivo para compor um path de Storage (sem separadores de
 *  caminho nem caracteres que quebrem a URL assinada). Nunca vazio. */
export function sanitizarNomeArquivo(nome: string | null | undefined): string {
  const base = (nome ?? '').trim().replace(/[^a-zA-Z0-9._-]/g, '_')
  return base || 'anexo'
}

/** Prefixo (dentro do bucket `documentos`) da área temporária de anexos que este
 *  tenant está enviando ao cliente. Termina com '/'. */
export function prefixoAnexoEnvio(tenantId: string): string {
  return `${tenantId}/conversas-envio/`
}

/** Monta o path do objeto temporário do anexo aguardando envio (bucket `documentos`). */
export function caminhoAnexoEnvio(tenantId: string, conversaId: string, filename: string): string {
  return `${prefixoAnexoEnvio(tenantId)}${conversaId}/${Date.now()}_${sanitizarNomeArquivo(filename)}`
}

/**
 * True se o path do Storage pertence à área de envio DESTE tenant.
 * LIÇÃO DA AUDITORIA: o storagePath vem do cliente e o admin client (service role)
 * ignora a RLS — baixaria/apagaria arquivo de QUALQUER tenant. O prefixo do tenant
 * é sempre validado antes de tocar o objeto; '..' é recusado como defesa extra.
 */
export function pathAnexoEnvioValido(
  storagePath: string | null | undefined,
  tenantId: string | null | undefined,
): boolean {
  if (!storagePath || !tenantId) return false
  if (storagePath.includes('..')) return false
  return storagePath.startsWith(prefixoAnexoEnvio(tenantId))
}

export type ValidacaoAnexoOk = { ok: true; contentType: string }
export type ValidacaoAnexoErro = { ok: false; erro: string; status: number }

/**
 * Guard PURO do preparar: valida tipo (allowlist, com fallback à extensão do nome)
 * e tamanho (<= LIMITE_UPLOAD_BYTES). Reusado pela rota /anexo/preparar e testado
 * isoladamente. Devolve o contentType já normalizado quando ok.
 */
export function validarAnexoParaEnvio(dados: {
  filename: string
  mimetype: string | null | undefined
  tamanho: number
}): ValidacaoAnexoOk | ValidacaoAnexoErro {
  const contentType = tipoBase(dados.mimetype) || mimePorNomeArquivo(dados.filename)
  if (!tipoAnexoPermitido(contentType)) {
    return { ok: false, erro: 'Tipo de arquivo não permitido', status: 400 }
  }
  if (!Number.isFinite(dados.tamanho) || dados.tamanho <= 0) {
    return { ok: false, erro: 'Tamanho inválido', status: 400 }
  }
  if (dados.tamanho > LIMITE_UPLOAD_BYTES) {
    return { ok: false, erro: 'Arquivo excede o limite de 40 MB', status: 413 }
  }
  return { ok: true, contentType }
}
