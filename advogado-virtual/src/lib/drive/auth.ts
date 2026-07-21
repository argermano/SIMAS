// server-only: autenticação do espelho no Google Drive via SERVICE ACCOUNT.
// Sem dependências novas: o token OAuth2 sai de um JWT bearer grant assinado com
// node:crypto (RS256) — nada de googleapis/jose. A credencial vem da env
// GOOGLE_DRIVE_SA_KEY_BASE64 (JSON da service account em base64) e a pasta raiz
// compartilhada com a SA de GOOGLE_DRIVE_PASTA_RAIZ. Sem as DUAS envs o espelho
// fica INERTE e silencioso (driveDisponivel() === false).
// SERVER-ONLY: manipula chave privada; nunca importar no bundle do cliente.

import { createSign, createPrivateKey } from 'node:crypto'

// Escopo configurável (auditoria item 21 — estreitamento): a env permite alternar
// para 'drive.file' (só arquivos criados pelo app) SEM deploy de código, e voltar
// se algo quebrar. ATENÇÃO: 'drive.file' NÃO enxerga a pasta-raiz criada
// MANUALMENTE (GOOGLE_DRIVE_PASTA_RAIZ) — estreitar aqui exige antes migrar a
// raiz para uma pasta criada pelo próprio app. O escopo pedido precisa constar
// do grant DWD no Admin Console (senão o token vira unauthorized_client).
const SCOPE = process.env.GOOGLE_DRIVE_SCOPE || 'https://www.googleapis.com/auth/drive'
// Renova o token com folga: melhor pedir de novo do que estourar no meio de um lote.
const MARGEM_EXPIRACAO_S = 60

export interface ServiceAccount {
  client_email: string
  private_key: string
  token_uri: string
}

/** Decodifica e valida o JSON base64 da service account. Puro (testável): recebe o
 *  base64 como argumento. Lança com mensagem clara se faltar campo (config errada). */
export function parseServiceAccount(base64: string): ServiceAccount {
  let json: unknown
  try {
    json = JSON.parse(Buffer.from(base64, 'base64').toString('utf8'))
  } catch {
    throw new Error('GOOGLE_DRIVE_SA_KEY_BASE64 inválida: não é base64 de um JSON')
  }
  const o = (json ?? {}) as Record<string, unknown>
  const client_email = typeof o.client_email === 'string' ? o.client_email : ''
  const private_key = typeof o.private_key === 'string' ? o.private_key : ''
  // token_uri é opcional no JSON da SA; cai no endpoint padrão do Google.
  const token_uri =
    typeof o.token_uri === 'string' && o.token_uri ? o.token_uri : 'https://oauth2.googleapis.com/token'
  if (!client_email || !private_key) {
    throw new Error('GOOGLE_DRIVE_SA_KEY_BASE64 inválida: faltam client_email/private_key')
  }
  return { client_email, private_key, token_uri }
}

/** As duas envs presentes? Portão do espelho: false → motor no-op (INERTE). */
export function driveDisponivel(): boolean {
  return !!process.env.GOOGLE_DRIVE_SA_KEY_BASE64 && !!process.env.GOOGLE_DRIVE_PASTA_RAIZ
}

/** Id da pasta raiz do Drive compartilhada com a SA (ou null se não configurada). */
export function pastaRaizId(): string | null {
  return process.env.GOOGLE_DRIVE_PASTA_RAIZ || null
}

/** Monta e ASSINA (RS256, node:crypto) o JWT do bearer grant. Puro dado `agora` —
 *  testável sem rede (só depende da chave privada da SA). */
export function montarJwtAssertion(
  sa: ServiceAccount,
  opts?: { agora?: number; scope?: string; impersonar?: string },
): string {
  const agora = Math.floor((opts?.agora ?? Date.now()) / 1000)
  const b64url = (obj: unknown) => Buffer.from(JSON.stringify(obj)).toString('base64url')
  const header = b64url({ alg: 'RS256', typ: 'JWT' })
  const claims = b64url({
    iss: sa.client_email,
    scope: opts?.scope ?? SCOPE,
    aud: sa.token_uri,
    iat: agora,
    exp: agora + 3600,
    // Domain-wide delegation: agir COMO um usuário do Workspace (sub). Sem isso,
    // arquivos criados pertencem à SA — que tem COTA ZERO no Drive, e o upload em
    // "Meu Drive" falha (pastas passam por ocuparem 0 byte; caso real do piloto).
    ...(opts?.impersonar ? { sub: opts.impersonar } : {}),
  })
  const entrada = `${header}.${claims}`
  const assinatura = createSign('RSA-SHA256')
    .update(entrada)
    .end()
    .sign(createPrivateKey(sa.private_key), 'base64url')
  return `${entrada}.${assinatura}`
}

// Cache do token em memória (por processo). Reusado até perto de expirar.
let cacheSa: ServiceAccount | null = null
let cacheToken: { valor: string; expiraEmMs: number } | null = null

function carregarSa(): ServiceAccount {
  if (!cacheSa) cacheSa = parseServiceAccount(process.env.GOOGLE_DRIVE_SA_KEY_BASE64 || '')
  return cacheSa
}

/** Access token OAuth2 (cacheado). Lança se a env estiver ausente/ inválida ou se o
 *  Google recusar — o chamador (espelho) trata como falha best-effort. */
export async function obterAccessToken(): Promise<string> {
  if (cacheToken && Date.now() < cacheToken.expiraEmMs) return cacheToken.valor
  const sa = carregarSa()
  // GOOGLE_DRIVE_IMPERSONATE (opcional): e-mail do usuário do Workspace dono da
  // pasta raiz — exige domain-wide delegation autorizada no Admin Console.
  const assertion = montarJwtAssertion(sa, {
    impersonar: process.env.GOOGLE_DRIVE_IMPERSONATE || undefined,
  })
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 10_000)
  try {
    const res = await fetch(sa.token_uri, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion,
      }),
      signal: ctrl.signal,
    })
    if (!res.ok) throw new Error(`Google token HTTP ${res.status}`)
    const data = (await res.json()) as { access_token?: string; expires_in?: number }
    if (!data.access_token) throw new Error('Google token sem access_token')
    const ttl = (data.expires_in ?? 3600) - MARGEM_EXPIRACAO_S
    cacheToken = { valor: data.access_token, expiraEmMs: Date.now() + Math.max(ttl, 30) * 1000 }
    return cacheToken.valor
  } finally {
    clearTimeout(timer)
  }
}

/** Descarta os caches (útil em testes / rotação de credencial). */
export function _resetAuthCache(): void {
  cacheSa = null
  cacheToken = null
}
