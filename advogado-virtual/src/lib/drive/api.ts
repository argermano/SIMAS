// server-only: cliente REST FINO da Google Drive API v3 (sem SDK). Cada função faz
// UMA operação, com timeout e 1 retry em erro transitório (429/5xx/rede). Em falha
// definitiva LANÇA DriveApiError — o chamador (espelho.ts) é quem captura por item
// (best-effort). Todas as chamadas passam supportsAllDrives (a raiz pode viver num
// Shared Drive). Recebe o access token pronto (ver auth.obterAccessToken).
// SERVER-ONLY.

const FILES = 'https://www.googleapis.com/drive/v3/files'
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3/files'
const MIME_PASTA = 'application/vnd.google-apps.folder'
const MIME_ATALHO = 'application/vnd.google-apps.shortcut'
const TIMEOUT_MS = 20_000

// Marcador da raiz PRÓPRIA do app (pasta criada por ele, sob o "Meu Drive" da
// impersonada). appProperties só é visível ao app que a criou — por isso serve de
// marcador estável mesmo sob o escopo estreito 'drive.file'. Ver garantirPastaRaizApp.
export const APP_RAIZ_KEY = 'simasRaiz'
export const APP_RAIZ_VALOR = 'v1'

/** Escapa aspas/barras para uso seguro num literal do parâmetro `q` da Drive API. */
const escaparQ = (s: string) => s.replace(/\\/g, '\\\\').replace(/'/g, "\\'")

/** PURO (testável): monta o `q` de busca da pasta-raiz do app — appProperties do
 *  marcador + mimeType de pasta + fora da lixeira. */
export function montarQRaizApp(): string {
  return (
    `appProperties has { key='${APP_RAIZ_KEY}' and value='${APP_RAIZ_VALOR}' }` +
    ` and mimeType='${MIME_PASTA}' and trashed=false`
  )
}

export class DriveApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message)
    this.name = 'DriveApiError'
  }
}

export type AppProperties = Record<string, string>

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** fetch com timeout + 1 retry em transitório. Lança DriveApiError no fim. */
async function driveFetch(token: string, url: string, init: RequestInit, corpo?: BodyInit): Promise<Response> {
  let ultimo: unknown = null
  for (let tentativa = 1; tentativa <= 2; tentativa++) {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS)
    try {
      const res = await fetch(url, {
        ...init,
        body: corpo ?? init.body,
        signal: ctrl.signal,
        headers: { authorization: `Bearer ${token}`, ...(init.headers ?? {}) },
      })
      if (res.ok) return res
      // 429/5xx são transitórios → 1 retry; 4xx "de verdade" não se conserta.
      const transitorio = res.status === 429 || res.status >= 500
      if (!transitorio || tentativa === 2) throw new DriveApiError(res.status, `Drive HTTP ${res.status}`)
      ultimo = new DriveApiError(res.status, `Drive HTTP ${res.status}`)
    } catch (e) {
      if (e instanceof DriveApiError && !(e.status === 429 || e.status >= 500)) throw e
      if (tentativa === 2) throw e instanceof DriveApiError ? e : new DriveApiError(0, 'Drive rede/timeout')
      ultimo = e
    } finally {
      clearTimeout(timer)
    }
    await sleep(800 * tentativa)
  }
  throw ultimo instanceof Error ? ultimo : new DriveApiError(0, 'Drive falha')
}

async function criarArquivoMeta(
  token: string,
  metadata: Record<string, unknown>,
): Promise<string> {
  const url = `${FILES}?supportsAllDrives=true&fields=id`
  const res = await driveFetch(token, url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(metadata),
  })
  const data = (await res.json()) as { id?: string }
  if (!data.id) throw new DriveApiError(0, 'Drive: resposta sem id')
  return data.id
}

/** Cria uma pasta e devolve o id. */
export function criarPasta(
  token: string,
  nome: string,
  parentId: string,
  appProperties?: AppProperties,
): Promise<string> {
  return criarArquivoMeta(token, { name: nome, mimeType: MIME_PASTA, parents: [parentId], appProperties })
}

/** Cria uma pasta SEM parents → cai na raiz do "Meu Drive" da impersonada. Usada só
 *  para a raiz PRÓPRIA do app (ver garantirPastaRaizApp). Devolve o id. */
export function criarPastaRaiz(
  token: string,
  nome: string,
  appProperties?: AppProperties,
): Promise<string> {
  return criarArquivoMeta(token, { name: nome, mimeType: MIME_PASTA, appProperties })
}

/** Cria um atalho NATIVO (shortcut) apontando para targetId. */
export function criarAtalho(
  token: string,
  nome: string,
  targetId: string,
  parentId: string,
  appProperties?: AppProperties,
): Promise<string> {
  return criarArquivoMeta(token, {
    name: nome,
    mimeType: MIME_ATALHO,
    parents: [parentId],
    shortcutDetails: { targetId },
    appProperties,
  })
}

/** Busca o 1º arquivo/pasta com appProperties[chave]=valor (opcionalmente sob
 *  parentId), fora da lixeira. Devolve o id ou null. Serve de RESGATE: se o
 *  bookkeeping se perdeu mas o objeto existe no Drive, reaproveitamos em vez de
 *  duplicar. */
export async function buscarPorAppProperty(
  token: string,
  chave: string,
  valor: string,
  parentId?: string,
): Promise<string | null> {
  const escapar = (s: string) => s.replace(/\\/g, '\\\\').replace(/'/g, "\\'")
  const clausulas = [`appProperties has { key='${escapar(chave)}' and value='${escapar(valor)}' }`, 'trashed=false']
  if (parentId) clausulas.push(`'${escapar(parentId)}' in parents`)
  const q = encodeURIComponent(clausulas.join(' and '))
  const url =
    `${FILES}?q=${q}&fields=files(id)&pageSize=1` +
    `&supportsAllDrives=true&includeItemsFromAllDrives=true`
  const res = await driveFetch(token, url, { method: 'GET' })
  const data = (await res.json()) as { files?: Array<{ id: string }> }
  return data.files?.[0]?.id ?? null
}

/** Busca a pasta-raiz do app no "Meu Drive" da impersonada (space 'drive'), pelo
 *  appProperties marcador (montarQRaizApp). Devolve {id, appProperties} da 1ª ou
 *  null. Sem `includeItemsFromAllDrives`: só o Meu Drive. */
export async function buscarPastaRaizApp(
  token: string,
): Promise<{ id: string; appProperties: AppProperties } | null> {
  const q = encodeURIComponent(montarQRaizApp())
  const url =
    `${FILES}?q=${q}&spaces=drive&fields=files(id,appProperties)&pageSize=1&supportsAllDrives=true`
  const res = await driveFetch(token, url, { method: 'GET' })
  const data = (await res.json()) as { files?: Array<{ id: string; appProperties?: AppProperties }> }
  const f = data.files?.[0]
  return f ? { id: f.id, appProperties: f.appProperties ?? {} } : null
}

/** Lista (UMA página) os ids dos filhos diretos de uma pasta, fora da lixeira
 *  (space 'drive'). Propaga DriveApiError — o chamador da migração trata 403/404
 *  (raiz invisível) como "nada a migrar". */
export async function listarFilhos(token: string, parentId: string, pageSize = 100): Promise<string[]> {
  const q = encodeURIComponent(`'${escaparQ(parentId)}' in parents and trashed=false`)
  const url =
    `${FILES}?q=${q}&spaces=drive&fields=files(id)&pageSize=${pageSize}&supportsAllDrives=true`
  const res = await driveFetch(token, url, { method: 'GET' })
  const data = (await res.json()) as { files?: Array<{ id: string }> }
  return (data.files ?? []).map((f) => f.id)
}

/** Mescla appProperties num arquivo/pasta (a v3 faz MERGE por chave — as demais
 *  são preservadas). Usada para MARCAR a raiz do app como migrada. */
export async function definirAppProperties(
  token: string,
  id: string,
  appProperties: AppProperties,
): Promise<void> {
  const url = `${FILES}/${encodeURIComponent(id)}?supportsAllDrives=true&fields=id`
  await driveFetch(token, url, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ appProperties }),
  })
}

/** Sobe um arquivo (multipart: metadata JSON + bytes). Devolve o id. */
export async function uploadArquivo(
  token: string,
  nome: string,
  mime: string,
  bytes: Buffer,
  parentId: string,
  appProperties?: AppProperties,
): Promise<string> {
  const fronteira = `simas-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
  const metadata = JSON.stringify({ name: nome, parents: [parentId], appProperties })
  // Corpo multipart/related: parte 1 = metadata JSON, parte 2 = mídia (bytes).
  const corpo = Buffer.concat([
    Buffer.from(
      `--${fronteira}\r\ncontent-type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n` +
        `--${fronteira}\r\ncontent-type: ${mime || 'application/octet-stream'}\r\n\r\n`,
    ),
    bytes,
    Buffer.from(`\r\n--${fronteira}--\r\n`),
  ])
  const url = `${UPLOAD}?uploadType=multipart&supportsAllDrives=true&fields=id`
  const res = await driveFetch(token, url, {
    method: 'POST',
    headers: { 'content-type': `multipart/related; boundary=${fronteira}` },
    body: corpo,
  })
  const data = (await res.json()) as { id?: string }
  if (!data.id) throw new DriveApiError(0, 'Drive upload: resposta sem id')
  return data.id
}

/** GET dos metadados de um arquivo/pasta pelo id (id, name, trashed). Devolve null
 *  se 404 (id inexistente ou sem acesso pela SA); demais erros propagam. Serve para
 *  VERIFICAR a pasta raiz do espelho sem expor o id na UI. */
export async function obterMeta(
  token: string,
  id: string,
): Promise<{ id: string; name?: string; trashed?: boolean } | null> {
  const url = `${FILES}/${encodeURIComponent(id)}?fields=id,name,trashed&supportsAllDrives=true`
  try {
    const res = await driveFetch(token, url, { method: 'GET' })
    return (await res.json()) as { id: string; name?: string; trashed?: boolean }
  } catch (e) {
    if (e instanceof DriveApiError && e.status === 404) return null
    throw e
  }
}

/** Renomeia um arquivo/pasta. */
export async function renomear(token: string, id: string, nome: string): Promise<void> {
  const url = `${FILES}/${encodeURIComponent(id)}?supportsAllDrives=true&fields=id`
  await driveFetch(token, url, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: nome }),
  })
}

/** Re-parenta um arquivo (files.update com addParents/removeParents): a mudança de
 *  pasta vai nos QUERY PARAMS; o corpo é um JSON vazio (semântica v3 — sem body de
 *  metadados). Serve quando o doc muda de pasta primária (ex.: Gerais → caso). */
export async function moverArquivo(
  token: string,
  fileId: string,
  addParent: string,
  removeParent: string,
): Promise<void> {
  const url =
    `${FILES}/${encodeURIComponent(fileId)}?supportsAllDrives=true&fields=id` +
    `&addParents=${encodeURIComponent(addParent)}&removeParents=${encodeURIComponent(removeParent)}`
  await driveFetch(token, url, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({}),
  })
}

/** Move para a LIXEIRA (nunca apaga de vez arquivos — recuperável). */
export async function moverLixeira(token: string, id: string): Promise<void> {
  const url = `${FILES}/${encodeURIComponent(id)}?supportsAllDrives=true&fields=id`
  await driveFetch(token, url, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ trashed: true }),
  })
}

/** Remove PERMANENTEMENTE — usar SÓ para atalhos (o arquivo real vai p/ lixeira). */
export async function removerPermanente(token: string, id: string): Promise<void> {
  const url = `${FILES}/${encodeURIComponent(id)}?supportsAllDrives=true`
  await driveFetch(token, url, { method: 'DELETE' })
}
