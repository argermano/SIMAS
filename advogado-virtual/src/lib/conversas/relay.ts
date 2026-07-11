// Cliente SERVER-ONLY do relay externo (Chatwoot omnichannel).
// INVARIANTE: RELAY_URL/RELAY_TOKEN só podem ser lidos aqui e nas rotas
// src/app/api/conversas/**. Nunca vão pro bundle do cliente. Nenhum segredo
// pode aparecer em log.

import { logger } from '@/lib/logger'

export interface RelayOpts {
  method?: string
  email: string
  body?: unknown
  query?: Record<string, string | undefined>
}

export interface RelayResposta {
  status: number
  data: unknown
}

/**
 * Monta a URL final juntando base + path + query, ignorando params undefined.
 * Pura e testável (não faz rede). Evita barras duplicadas na junção.
 */
export function montarUrl(
  base: string,
  path: string,
  query?: Record<string, string | undefined>,
): string {
  const baseLimpa = base.replace(/\/+$/, '')
  const pathLimpo = path.startsWith('/') ? path : `/${path}`
  let url = `${baseLimpa}${pathLimpo}`

  if (query) {
    const params = new URLSearchParams()
    for (const [chave, valor] of Object.entries(query)) {
      if (valor !== undefined) params.append(chave, valor)
    }
    const qs = params.toString()
    if (qs) url += `${url.includes('?') ? '&' : '?'}${qs}`
  }

  return url
}

const TIMEOUT_MS = 8000
const TIMEOUT_BINARIO_MS = 15000

/**
 * Faz uma requisição ao relay injetando Authorization Bearer + X-Simas-User-Email.
 * Best-effort: nunca lança. Retorna { status, data } com o JSON parseado do relay
 * (ou {} se o corpo não for JSON). Status especiais gerados aqui:
 *   503 RELAY_NAO_CONFIGURADO  — faltam envs
 *   502 RELAY_INDISPONIVEL     — erro de rede / timeout
 */
export async function relayFetch(path: string, opts: RelayOpts): Promise<RelayResposta> {
  const base = process.env.RELAY_URL
  const token = process.env.RELAY_TOKEN
  if (!base || !token) {
    logger.error('conversas.relay.sem_config', { temUrl: !!base, temToken: !!token })
    return { status: 503, data: { code: 'RELAY_NAO_CONFIGURADO' } }
  }

  const url = montarUrl(base, path, opts.query)
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    'X-Simas-User-Email': opts.email,
  }
  const temBody = opts.body !== undefined
  if (temBody) headers['Content-Type'] = 'application/json'

  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS)
  try {
    const r = await fetch(url, {
      method: opts.method ?? 'GET',
      headers,
      body: temBody ? JSON.stringify(opts.body) : undefined,
      signal: ctrl.signal,
    })
    let data: unknown = {}
    try {
      data = await r.json()
    } catch {
      data = {}
    }
    return { status: r.status, data }
  } catch (err) {
    logger.error('conversas.relay.indisponivel', { path }, err)
    return { status: 502, data: { code: 'RELAY_INDISPONIVEL' } }
  } finally {
    clearTimeout(timer)
  }
}

export interface RelayRespostaBinaria {
  status: number
  buffer: Buffer | null
  contentType: string | null
}

/**
 * Como o relayFetch, mas devolve o corpo como BYTES (anexos de mídia: imagens,
 * PDFs). Best-effort: nunca lança. Em erro do relay o corpo (ex.: JSON de erro)
 * ainda é devolvido como buffer, com o status repassado — quem chama decide.
 * Mesmos status especiais: 503 RELAY_NAO_CONFIGURADO / 502 RELAY_INDISPONIVEL
 * (nesses dois casos buffer = null).
 */
export async function relayFetchBinario(path: string, opts: RelayOpts): Promise<RelayRespostaBinaria> {
  const base = process.env.RELAY_URL
  const token = process.env.RELAY_TOKEN
  if (!base || !token) {
    logger.error('conversas.relay.sem_config', { temUrl: !!base, temToken: !!token })
    return { status: 503, buffer: null, contentType: null }
  }

  const url = montarUrl(base, path, opts.query)
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_BINARIO_MS)
  try {
    const r = await fetch(url, {
      method: opts.method ?? 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
        'X-Simas-User-Email': opts.email,
      },
      signal: ctrl.signal,
    })
    const ab = await r.arrayBuffer()
    return {
      status: r.status,
      buffer: Buffer.from(ab),
      contentType: r.headers.get('content-type'),
    }
  } catch (err) {
    logger.error('conversas.relay.indisponivel', { path }, err)
    return { status: 502, buffer: null, contentType: null }
  } finally {
    clearTimeout(timer)
  }
}
