/**
 * Cliente HTTP para a API da D4Sign.
 * Autenticação via query params: ?tokenAPI=...&cryptKey=...
 * Docs: https://docapi.d4sign.com.br/
 */

import { logger } from '@/lib/logger'
import type {
  D4SignUploadResponse,
  D4SignDocument,
  D4SignSignerInput,
  D4SignSignerResponse,
  D4SignSendOptions,
} from './types'

function base() {
  return process.env.D4SIGN_BASE_URL ?? 'https://sandbox.d4sign.com.br/api/v1'
}

function auth() {
  const token = process.env.D4SIGN_TOKEN_API
  const crypt  = process.env.D4SIGN_CRYPT_KEY
  if (!token || !crypt) throw new Error('D4Sign: variáveis D4SIGN_TOKEN_API / D4SIGN_CRYPT_KEY não configuradas')
  return `?tokenAPI=${token}&cryptKey=${crypt}`
}

/** Pausa entre chamadas sequenciais à API D4Sign (respeitar rate limit) */
export function d4signDelay(ms = 2000): Promise<void> {
  return new Promise(r => setTimeout(r, ms))
}

// Timeout obrigatório em cada chamada: sem ele uma conexão pendurada com a
// D4Sign trava a função serverless até a Vercel encerrá-la à força.
const D4SIGN_TIMEOUT_MS = 20_000

/**
 * Erro do cliente D4Sign com a origem classificada em `kind`, para o chamador
 * diferenciar timeout/rede de erro HTTP da API sem casar substrings da mensagem.
 */
export class D4SignError extends Error {
  constructor(
    readonly kind: 'timeout' | 'http' | 'rede',
    message: string,
    readonly status?: number,
  ) {
    super(message)
    this.name = 'D4SignError'
  }
}

/** fetch com timeout obrigatório; classifica falhas de timeout/rede como D4SignError. */
async function d4signFetch(label: string, url: string, init?: RequestInit): Promise<Response> {
  try {
    return await fetch(url, { ...init, signal: AbortSignal.timeout(D4SIGN_TIMEOUT_MS) })
  } catch (err: unknown) {
    // AbortSignal.timeout aborta com um erro cujo name é 'TimeoutError'.
    const name = (err as { name?: unknown })?.name
    if (name === 'TimeoutError' || name === 'AbortError') {
      throw new D4SignError('timeout', `D4Sign ${label}: timeout após ${D4SIGN_TIMEOUT_MS / 1000}s`)
    }
    throw new D4SignError('rede', `D4Sign ${label}: falha de rede — ${err instanceof Error ? err.message : String(err)}`)
  }
}

/**
 * Monta o erro HTTP mantendo o corpo na mensagem: o rate limit da D4Sign chega
 * como HTTP 401 com "tempo limite" no corpo, detectado em withRetry.
 */
async function d4signHttpError(label: string, res: Response): Promise<D4SignError> {
  return new D4SignError('http', `D4Sign ${label}: HTTP ${res.status} — ${await res.text()}`, res.status)
}

async function withRetry<T>(fn: () => Promise<T>, retries = 2): Promise<T> {
  let delay = 5000
  for (let i = 0; i < retries; i++) {
    try {
      return await fn()
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      // D4Sign retorna HTTP 401 com "tempo limite" para rate limit — NÃO fazer retry
      // pois retries só pioram o bloqueio. Apenas fazer retry em erros de servidor (5xx).
      const isD4SignRateLimit = msg.includes('tempo limite')
      if (isD4SignRateLimit) throw err
      const isServerError = /HTTP\s+5\d{2}/.test(msg)
      if (i === retries - 1 || !isServerError) throw err
      // LGPD: sem o corpo cru da resposta (pode conter e-mails) — só status/contagem.
      logger.warn('d4sign.retry', { tentativa: i + 1, retries, delayMs: delay, status: msg.match(/HTTP\s+(\d{3})/)?.[1] })
      await new Promise(r => setTimeout(r, delay))
      delay *= 3
    }
  }
  throw new Error('Retry exhausted')
}

// ─── Listar cofres (safes) ───────────────────────────────────────────────────
export async function d4signListSafes(): Promise<{ uuid_safe: string; name_safe: string }[]> {
  return withRetry(async () => {
    const res = await d4signFetch('listSafes', `${base()}/safes${auth()}`, {
      headers: { Accept: 'application/json' },
    })
    if (!res.ok) throw await d4signHttpError('listSafes', res)
    const data = await res.json()
    return Array.isArray(data) ? data : []
  })
}

// ─── Upload de documento ───────────────────────────────────────────────────────
export async function d4signUploadDocument(
  safeUuid: string,
  fileBuffer: Buffer,
  fileName: string,
  mimeType = 'application/pdf',
): Promise<D4SignUploadResponse> {
  return withRetry(async () => {
    const form = new FormData()
    form.append('file', new Blob([new Uint8Array(fileBuffer)], {
      type: mimeType,
    }), fileName)
    form.append('uuid_folder', '')

    const res = await d4signFetch('upload', `${base()}/documents/${safeUuid}/upload${auth()}`, {
      method: 'POST',
      body:   form,
    })
    if (!res.ok) throw await d4signHttpError('upload', res)
    const data = await res.json()
    if (!data?.uuid) throw new Error(`D4Sign upload: uuid não retornado — ${JSON.stringify(data)}`)
    return { uuid: data.uuid }
  })
}

// ─── Cadastrar signatários ────────────────────────────────────────────────────
export async function d4signAddSigners(
  docUuid: string,
  signers: D4SignSignerInput[],
): Promise<D4SignSignerResponse[]> {
  return withRetry(async () => {
    const res = await d4signFetch('addSigners', `${base()}/documents/${docUuid}/createlist${auth()}`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body:    JSON.stringify({ signers }),
    })
    if (!res.ok) throw await d4signHttpError('addSigners', res)
    const data = await res.json()
    // D4Sign retorna { message: [{email, key_signer}] } ou variações
    return Array.isArray(data?.message) ? data.message : (data?.signers ?? [])
  })
}

// ─── Posicionar assinaturas no documento (página específica) ─────────────────
export interface PinPosition {
  email: string
  page: string
  positionX: string
  positionY: string
  type?: '0' | '1' | '2'   // 0=assinatura, 1=rubrica, 2=carimbo
}

export async function d4signAddPins(
  docUuid: string,
  pins: PinPosition[],
): Promise<void> {
  return withRetry(async () => {
    const body = {
      pins: pins.map(p => ({
        document:    docUuid,
        email:       p.email,
        page:        p.page,
        page_height: '1097',
        page_width:  '790',
        position_x:  p.positionX,
        position_y:  p.positionY,
        type:        p.type ?? '0',
      })),
    }
    // LGPD: o corpo traz e-mails dos signatários — logar só ids/contagem, nunca o payload.
    logger.info('d4sign.addpins.req', { docUuid, totalPins: pins.length })
    const res = await d4signFetch('addPins', `${base()}/documents/${docUuid}/addpins${auth()}`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body:    JSON.stringify(body),
    })
    logger.info('d4sign.addpins.res', { docUuid, status: res.status, ok: res.ok })
    if (!res.ok) throw await d4signHttpError('addPins', res)
  })
}

// ─── Registrar webhook ────────────────────────────────────────────────────────
export async function d4signRegisterWebhook(docUuid: string, url: string): Promise<void> {
  return withRetry(async () => {
    const res = await d4signFetch('webhook', `${base()}/documents/${docUuid}/webhooks${auth()}`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body:    JSON.stringify({ url }),
    })
    if (!res.ok) throw await d4signHttpError('webhook', res)
  })
}

// ─── Enviar para assinatura ───────────────────────────────────────────────────
export async function d4signSendToSign(
  docUuid: string,
  options?: D4SignSendOptions,
): Promise<unknown> {
  return withRetry(async () => {
    const body = {
      message:    options?.message    ?? '',
      skip_email: options?.skip_email ?? '0',
      workflow:   options?.workflow   ?? '0',
    }
    logger.info('d4sign.sendtosign.req', { docUuid })
    const res = await d4signFetch('sendToSign', `${base()}/documents/${docUuid}/sendtosigner${auth()}`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body:    JSON.stringify(body),
    })
    // Corpo lido uma única vez: serve tanto para o retorno quanto para o erro.
    const responseText = await res.text()
    logger.info('d4sign.sendtosign.res', { docUuid, status: res.status, ok: res.ok })
    if (!res.ok) throw new D4SignError('http', `D4Sign sendToSign: HTTP ${res.status} — ${responseText}`, res.status)
    try { return JSON.parse(responseText) } catch { return responseText }
  })
}

// ─── Consultar status ─────────────────────────────────────────────────────────
export async function d4signGetStatus(docUuid: string): Promise<D4SignDocument> {
  return withRetry(async () => {
    const res = await d4signFetch('getStatus', `${base()}/documents/${docUuid}${auth()}`, {
      headers: { Accept: 'application/json' },
    })
    if (!res.ok) throw await d4signHttpError('getStatus', res)
    return res.json()
  })
}

// ─── Listar signatários ───────────────────────────────────────────────────────
export async function d4signListSigners(docUuid: string) {
  return withRetry(async () => {
    const res = await d4signFetch('listSigners', `${base()}/documents/${docUuid}/list${auth()}`, {
      headers: { Accept: 'application/json' },
    })
    if (!res.ok) throw await d4signHttpError('listSigners', res)
    return res.json()
  })
}

// ─── Obter link individual de assinatura ─────────────────────────────────────
export async function d4signGetSigningLink(docUuid: string, signerEmail: string): Promise<string> {
  return withRetry(async () => {
    const res = await d4signFetch('signingLink', `${base()}/documents/${docUuid}/signinglink${auth()}`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body:    JSON.stringify({ email: signerEmail }),
    })
    if (!res.ok) throw await d4signHttpError('signingLink', res)
    const data = await res.json()
    return data?.link ?? data?.url ?? ''
  })
}

// ─── Download do documento assinado ──────────────────────────────────────────
export async function d4signDownloadDocument(docUuid: string): Promise<string> {
  return withRetry(async () => {
    const res = await d4signFetch('download', `${base()}/documents/${docUuid}/download${auth()}`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body:    JSON.stringify({}),
    })
    if (!res.ok) throw await d4signHttpError('download', res)
    const data = await res.json()
    return data?.url ?? data?.link ?? ''
  })
}

// ─── Cancelar documento ───────────────────────────────────────────────────────
export async function d4signCancelDocument(docUuid: string, comment = ''): Promise<void> {
  return withRetry(async () => {
    const res = await d4signFetch('cancel', `${base()}/documents/${docUuid}/cancel${auth()}`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body:    JSON.stringify({ comment }),
    })
    if (!res.ok) throw await d4signHttpError('cancel', res)
  })
}

// ─── Reenviar notificação ─────────────────────────────────────────────────────
export async function d4signResendNotification(docUuid: string, signerKey: string): Promise<void> {
  return withRetry(async () => {
    const res = await d4signFetch('resend', `${base()}/documents/${docUuid}/resend${auth()}`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body:    JSON.stringify({ key_signer: signerKey }),
    })
    if (!res.ok) throw await d4signHttpError('resend', res)
  })
}
