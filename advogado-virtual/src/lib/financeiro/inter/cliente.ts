// Integração Banco Inter — NÚCLEO mTLS + token OAuth. SERVER-ONLY, INERTE.
// Roda SEMPRE em runtime nodejs (usa node:https; quebraria no edge). Nunca é
// importado por código de cliente. Enquanto estaConfigurado() é false, todas as
// chamadas retornam { ok:false } sem tocar a rede.
//
// mTLS: a doc do Inter descreve o dispatcher da undici (connect { cert, key }),
// mas a undici NÃO é importável neste Node (não é builtin público nem está no
// node_modules, e não podemos adicionar dependência). Usamos o equivalente
// nativo e sem dependências: um https.Agent com { cert, key }, que faz a mesma
// autenticação por certificado de cliente. Por isso interFetch usa node:https
// em vez do fetch global (o fetch global não aceita um Agent nativo como
// dispatcher). A função mantém o nome dispatcherMtls() por continuidade da API.

import https from 'node:https'
import {
  baseUrl,
  certPem,
  keyPem,
  clientId,
  clientSecret,
  contaCorrente,
  estaConfigurado,
  envsFaltando,
} from './config'

// Escopos que a integração usa (emitir/consultar boleto + ler extrato).
const ESCOPOS_PADRAO = 'boleto-cobranca.read boleto-cobranca.write extrato.read'
// Reusa o token enquanto faltar > 60s para expirar (o token vale ~60min e o
// endpoint aceita ~5 req/min — pedir a cada request estouraria o limite).
const MARGEM_EXPIRACAO_MS = 60_000
const TIMEOUT_MS = 20_000

// Resultado uniforme: nunca lança para fora nem coloca segredo em `erro`.
export interface ResultadoInter<T = unknown> {
  ok: boolean
  status: number
  dados?: T
  erro?: string
}

interface TokenCache {
  accessToken: string
  expiraEm: number // epoch ms
}

// Agent mTLS memoizado (reusa conexões TLS). Reset só em teste.
let agenteMtls: https.Agent | null = null
// Cache de token por escopo (na prática só ESCOPOS_PADRAO).
const tokens = new Map<string, TokenCache>()

/** Cria (memoizado) o Agent mTLS com cert+key do cliente. Runtime nodejs. */
export function dispatcherMtls(): https.Agent {
  if (agenteMtls) return agenteMtls
  agenteMtls = new https.Agent({ cert: certPem(), key: keyPem(), keepAlive: true })
  return agenteMtls
}

/** Limpa caches de Agent e token — uso EXCLUSIVO de teste/rotação; não chamar em fluxo normal. */
export function _resetCache(): void {
  agenteMtls = null
  tokens.clear()
}

function mensagemErro(e: unknown): string {
  if (e instanceof Error) {
    if (e.name === 'AbortError') return 'tempo esgotado ao contatar o Inter'
    return e.message
  }
  return String(e)
}

// Requisição HTTPS crua com o Agent mTLS. Promessa que resolve com status+corpo
// e rejeita em erro de rede/abort. Não interpreta o corpo (quem chama decide).
function requisicaoHttps(
  url: string,
  opcoes: { method: string; headers: Record<string, string>; body?: string; signal: AbortSignal },
): Promise<{ status: number; corpo: string }> {
  return new Promise((resolve, reject) => {
    const req = https.request(
      url,
      { method: opcoes.method, headers: opcoes.headers, agent: dispatcherMtls(), signal: opcoes.signal },
      (res) => {
        const partes: Buffer[] = []
        res.on('data', (c: Buffer) => partes.push(c))
        // Erro no meio da resposta (reset/abort após os headers) chega no `res`,
        // não no `req` — sem este listener o EventEmitter lançaria descontrolado
        // e quebraria a garantia "interFetch nunca lança".
        res.on('error', reject)
        res.on('end', () => resolve({ status: res.statusCode ?? 0, corpo: Buffer.concat(partes).toString('utf8') }))
      },
    )
    req.on('error', reject)
    if (opcoes.body) req.write(opcoes.body)
    req.end()
  })
}

/**
 * Obtém o access_token (client_credentials, mTLS), com cache em memória por
 * escopo. Reusa enquanto faltar > 60s para expirar. Lança em falha (interFetch
 * captura e converte em ResultadoInter).
 */
export async function obterToken(
  escopo = ESCOPOS_PADRAO,
): Promise<{ accessToken: string; expiraEm: number }> {
  const agora = Date.now()
  const cache = tokens.get(escopo)
  if (cache && cache.expiraEm - agora > MARGEM_EXPIRACAO_MS) return cache

  if (!estaConfigurado()) {
    throw new Error(`Inter não configurado: faltam as envs ${envsFaltando().join(', ')}`)
  }

  const corpo = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: clientId(),
    client_secret: clientSecret(),
    scope: escopo,
  }).toString()

  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS)
  let resposta: { status: number; corpo: string }
  try {
    resposta = await requisicaoHttps(`${baseUrl()}/oauth/v2/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
      body: corpo,
      signal: ctrl.signal,
    })
  } finally {
    clearTimeout(timer)
  }

  // Nunca inclui o corpo da resposta de OAuth na mensagem (poderia ecoar dados
  // sensíveis do erro) — só o status.
  if (resposta.status < 200 || resposta.status >= 300) {
    throw new Error(`Inter OAuth falhou (HTTP ${resposta.status})`)
  }

  let dados: { access_token?: string; expires_in?: number }
  try {
    dados = JSON.parse(resposta.corpo)
  } catch {
    throw new Error('Inter OAuth: resposta não-JSON')
  }
  if (!dados.access_token) throw new Error('Inter OAuth: resposta sem access_token')

  const expiraEm = agora + (typeof dados.expires_in === 'number' ? dados.expires_in : 3600) * 1000
  const novo: TokenCache = { accessToken: dados.access_token, expiraEm }
  tokens.set(escopo, novo)
  return novo
}

function parseJsonSeguro(texto: string): unknown {
  const t = texto.trim()
  if (!t) return undefined
  try {
    return JSON.parse(t)
  } catch {
    return undefined
  }
}

// Erro do Inter costuma vir em problem+json { title, detail, violacoes[] }.
// title/detail são descrições do PRÓPRIO banco (não segredos nossos) — seguros
// de propagar para diagnóstico. Nunca inclui headers/token.
function mensagemErroInter(status: number, dados: unknown): string {
  const d = (dados ?? {}) as Record<string, unknown>
  const titulo = typeof d.title === 'string' ? d.title : undefined
  const detalhe = typeof d.detail === 'string' ? d.detail : undefined
  const msg = [titulo, detalhe].filter(Boolean).join(' — ')
  return msg ? `Inter HTTP ${status}: ${msg}` : `Inter HTTP ${status}`
}

/**
 * Chamada autenticada ao Inter: Bearer + mTLS + x-conta-corrente (quando setada)
 * + timeout. Devolve SEMPRE um ResultadoInter (nunca lança, nunca vaza segredo).
 * Reautentica UMA vez em 401 (token pode ter sido revogado antes de expirar).
 */
export async function interFetch<T = unknown>(
  path: string,
  opcoes: {
    method?: string
    body?: unknown
    escopo?: string
    headers?: Record<string, string>
    _reautenticou?: boolean // interno: evita loop de reautenticação
  } = {},
): Promise<ResultadoInter<T>> {
  if (!estaConfigurado()) {
    return { ok: false, status: 0, erro: `Inter não configurado: faltam as envs ${envsFaltando().join(', ')}` }
  }

  let token: { accessToken: string }
  try {
    token = await obterToken(opcoes.escopo)
  } catch (e) {
    return { ok: false, status: 0, erro: mensagemErro(e) }
  }

  const cc = contaCorrente()
  const headers: Record<string, string> = {
    authorization: `Bearer ${token.accessToken}`,
    accept: 'application/json',
    ...(opcoes.body !== undefined ? { 'content-type': 'application/json' } : {}),
    ...(cc ? { 'x-conta-corrente': cc } : {}),
    ...opcoes.headers,
  }

  const url = path.startsWith('http') ? path : `${baseUrl()}${path}`
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS)
  let resposta: { status: number; corpo: string }
  try {
    resposta = await requisicaoHttps(url, {
      method: opcoes.method ?? 'GET',
      headers,
      body: opcoes.body !== undefined ? JSON.stringify(opcoes.body) : undefined,
      signal: ctrl.signal,
    })
  } catch (e) {
    return { ok: false, status: 0, erro: mensagemErro(e) }
  } finally {
    clearTimeout(timer)
  }

  // 401: descarta o token cacheado e tenta de novo uma única vez.
  if (resposta.status === 401 && !opcoes._reautenticou) {
    tokens.clear()
    return interFetch<T>(path, { ...opcoes, _reautenticou: true })
  }

  const dados = parseJsonSeguro(resposta.corpo)
  if (resposta.status < 200 || resposta.status >= 300) {
    return { ok: false, status: resposta.status, erro: mensagemErroInter(resposta.status, dados) }
  }
  return { ok: true, status: resposta.status, dados: dados as T }
}
