// Files API da Anthropic (beta) — o canal por onde os arquivos que o modelo
// PRODUZ no sandbox do `code_execution` saem de lá (F0.5).
//
// O server tool devolve, em cada bloco de resultado, um `file_id` por arquivo
// criado no container. O conteúdo NÃO vem no bloco: é preciso buscar metadados
// (nome, mime, tamanho) e baixar os bytes pela Files API — que continua em BETA,
// então toda chamada leva o header `files-api-2025-04-14` (o SDK o monta a
// partir de `betas`).
//
// Fonte: skill claude-api → typescript/claude-api/tool-use.md ("Retrieve
// Generated Files": `client.beta.files.retrieveMetadata(file_id)` +
// `client.beta.files.download(file_id)`) e typescript/claude-api/files-api.md
// (`betas: ['files-api-2025-04-14']` em todas as operações de arquivo).
//
// SERVER-ONLY.

import { getAnthropicClient } from './client'

/** Beta da Files API — obrigatório em upload/list/download/metadata. */
export const BETA_FILES = 'files-api-2025-04-14' as const

/** Um arquivo já baixado do container (bytes na memória). */
export interface ArquivoAnthropic {
  fileId: string
  /** Nome original dado pelo modelo no sandbox (ex.: "calculos-rescisao.xlsx"). */
  nome: string
  mimeType: string
  tamanho: number
  bytes: Buffer
}

/** Metadados sem baixar o conteúdo — usados para aplicar teto/allowlist antes. */
export interface MetadadosArquivoAnthropic {
  fileId: string
  nome: string
  mimeType: string
  tamanho: number
  /** A API marca arquivos que não podem ser baixados (ex.: expirados). */
  baixavel: boolean
}

export async function metadadosArquivo(fileId: string): Promise<MetadadosArquivoAnthropic> {
  const client = getAnthropicClient()
  const meta = await client.beta.files.retrieveMetadata(fileId, { betas: [BETA_FILES] })
  return {
    fileId: meta.id,
    nome: meta.filename ?? '',
    mimeType: meta.mime_type ?? 'application/octet-stream',
    tamanho: meta.size_bytes ?? 0,
    baixavel: meta.downloadable !== false,
  }
}

/**
 * Baixa os bytes de um arquivo da Files API. Quem chama já decidiu (pelos
 * metadados) que vale a pena baixar — aqui não há política, só transporte.
 */
export async function baixarArquivo(meta: MetadadosArquivoAnthropic): Promise<ArquivoAnthropic> {
  const client = getAnthropicClient()
  const resposta = await client.beta.files.download(meta.fileId, { betas: [BETA_FILES] })
  const bytes = Buffer.from(await resposta.arrayBuffer())
  return {
    fileId: meta.fileId,
    nome: meta.nome,
    mimeType: meta.mimeType,
    // O tamanho REAL do que baixamos manda (o metadado é só uma promessa).
    tamanho: bytes.length,
    bytes,
  }
}
