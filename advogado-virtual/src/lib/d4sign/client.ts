/**
 * Cliente HTTP para a API da D4Sign.
 * Autenticação via query params: ?tokenAPI=...&cryptKey=...
 * Docs: https://docapi.d4sign.com.br/
 */

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
      console.warn(`[D4Sign] Retry ${i + 1}/${retries} após ${delay}ms: ${msg}`)
      await new Promise(r => setTimeout(r, delay))
      delay *= 3
    }
  }
  throw new Error('Retry exhausted')
}

// ─── Listar cofres (safes) ───────────────────────────────────────────────────
export async function d4signListSafes(): Promise<{ uuid_safe: string; name_safe: string }[]> {
  return withRetry(async () => {
    const res = await fetch(`${base()}/safes${auth()}`, {
      headers: { Accept: 'application/json' },
    })
    if (!res.ok) throw new Error(`D4Sign listSafes: HTTP ${res.status} — ${await res.text()}`)
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

    const res = await fetch(`${base()}/documents/${safeUuid}/upload${auth()}`, {
      method: 'POST',
      body:   form,
    })
    if (!res.ok) throw new Error(`D4Sign upload: HTTP ${res.status} — ${await res.text()}`)
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
    const res = await fetch(`${base()}/documents/${docUuid}/createlist${auth()}`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body:    JSON.stringify({ signers }),
    })
    if (!res.ok) throw new Error(`D4Sign addSigners: HTTP ${res.status} — ${await res.text()}`)
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
    console.log('[D4Sign] addPins:', JSON.stringify(body, null, 2))
    const res = await fetch(`${base()}/documents/${docUuid}/addpins${auth()}`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body:    JSON.stringify(body),
    })
    const responseText = await res.text()
    console.log('[D4Sign] addPins response:', res.status, responseText)
    if (!res.ok) throw new Error(`D4Sign addPins: HTTP ${res.status} — ${responseText}`)
  })
}

// ─── Registrar webhook ────────────────────────────────────────────────────────
export async function d4signRegisterWebhook(docUuid: string, url: string): Promise<void> {
  return withRetry(async () => {
    const res = await fetch(`${base()}/documents/${docUuid}/webhooks${auth()}`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body:    JSON.stringify({ url }),
    })
    if (!res.ok) throw new Error(`D4Sign webhook: HTTP ${res.status} — ${await res.text()}`)
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
    console.log('[D4Sign] sendToSign request:', { docUuid, body })
    const res = await fetch(`${base()}/documents/${docUuid}/sendtosigner${auth()}`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body:    JSON.stringify(body),
    })
    const responseText = await res.text()
    console.log('[D4Sign] sendToSign response:', res.status, responseText)
    if (!res.ok) throw new Error(`D4Sign sendToSign: HTTP ${res.status} — ${responseText}`)
    try { return JSON.parse(responseText) } catch { return responseText }
  })
}

// ─── Consultar status ─────────────────────────────────────────────────────────
export async function d4signGetStatus(docUuid: string): Promise<D4SignDocument> {
  return withRetry(async () => {
    const res = await fetch(`${base()}/documents/${docUuid}${auth()}`, {
      headers: { Accept: 'application/json' },
    })
    if (!res.ok) throw new Error(`D4Sign getStatus: HTTP ${res.status} — ${await res.text()}`)
    return res.json()
  })
}

// ─── Listar signatários ───────────────────────────────────────────────────────
export async function d4signListSigners(docUuid: string) {
  return withRetry(async () => {
    const res = await fetch(`${base()}/documents/${docUuid}/list${auth()}`, {
      headers: { Accept: 'application/json' },
    })
    if (!res.ok) throw new Error(`D4Sign listSigners: HTTP ${res.status} — ${await res.text()}`)
    return res.json()
  })
}

// ─── Obter link individual de assinatura ─────────────────────────────────────
export async function d4signGetSigningLink(docUuid: string, signerEmail: string): Promise<string> {
  return withRetry(async () => {
    const res = await fetch(`${base()}/documents/${docUuid}/signinglink${auth()}`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body:    JSON.stringify({ email: signerEmail }),
    })
    if (!res.ok) throw new Error(`D4Sign signingLink: HTTP ${res.status} — ${await res.text()}`)
    const data = await res.json()
    return data?.link ?? data?.url ?? ''
  })
}

// ─── Download do documento assinado ──────────────────────────────────────────
export async function d4signDownloadDocument(docUuid: string): Promise<string> {
  return withRetry(async () => {
    const res = await fetch(`${base()}/documents/${docUuid}/download${auth()}`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body:    JSON.stringify({}),
    })
    if (!res.ok) throw new Error(`D4Sign download: HTTP ${res.status} — ${await res.text()}`)
    const data = await res.json()
    return data?.url ?? data?.link ?? ''
  })
}

// ─── Cancelar documento ───────────────────────────────────────────────────────
export async function d4signCancelDocument(docUuid: string, comment = ''): Promise<void> {
  return withRetry(async () => {
    const res = await fetch(`${base()}/documents/${docUuid}/cancel${auth()}`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body:    JSON.stringify({ comment }),
    })
    if (!res.ok) throw new Error(`D4Sign cancel: HTTP ${res.status} — ${await res.text()}`)
  })
}

// ─── Reenviar notificação ─────────────────────────────────────────────────────
export async function d4signResendNotification(docUuid: string, signerKey: string): Promise<void> {
  return withRetry(async () => {
    const res = await fetch(`${base()}/documents/${docUuid}/resend${auth()}`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body:    JSON.stringify({ key_signer: signerKey }),
    })
    if (!res.ok) throw new Error(`D4Sign resend: HTTP ${res.status} — ${await res.text()}`)
  })
}
