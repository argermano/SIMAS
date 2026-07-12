// Integração Banco Inter (BolePix v3 + Extrato) — CONFIG. SERVER-ONLY, INERTE.
// Lê e valida as envs do cofre da Vercel. Nunca loga valores; erros dizem QUAL
// env falta, jamais o conteúdo. Enquanto as credenciais não entram (integração
// em validação no banco), estaConfigurado() é false e toda a lib fica inerte.

export type AmbienteInter = 'sandbox' | 'producao'

// Bases oficiais (developers.inter.co). A v2 do BolePix foi descontinuada.
const BASES: Record<AmbienteInter, string> = {
  producao: 'https://cdpj.partners.bancointer.com.br',
  sandbox: 'https://cdpj-sandbox.partners.uatinter.co',
}

// Envs sem as quais nada funciona (auth mTLS + client_credentials).
const ESSENCIAIS = [
  'INTER_CLIENT_ID',
  'INTER_CLIENT_SECRET',
  'INTER_CERT_BASE64',
  'INTER_KEY_BASE64',
] as const

// Marcadores comuns de "ainda não preenchi" — env de cofre às vezes fica com um
// placeholder. Comparação EXATA (não substring) de propósito: o base64 do
// cert/key usa o alfabeto A–Za–z0–9+/ e poderia conter uma dessas palavras por
// acaso; um falso positivo aqui deixaria a lib inerte com credencial válida.
const PLACEHOLDERS_EXATOS = new Set(['changeme', 'placeholder', 'todo', 'xxx', 'xxxx', 'none', 'null', 'undefined'])

function bruto(nome: string): string {
  return (process.env[nome] ?? '').trim()
}

// Um valor "parece real" se não é vazio, nem um placeholder óbvio. base64 padrão
// não começa com '<' nem com 'seu_/your_' (têm '_' fora do alfabeto), então
// esses prefixos só pegam placeholders, nunca um cert/key legítimo.
function pareceValor(v: string): boolean {
  if (!v) return false
  if (PLACEHOLDERS_EXATOS.has(v.toLowerCase())) return false
  if (v.startsWith('<')) return false
  if (/^(seu_|sua_|your_|my_|coloque)/i.test(v)) return false
  return true
}

export function ambiente(): AmbienteInter {
  return bruto('INTER_AMBIENTE').toLowerCase() === 'sandbox' ? 'sandbox' : 'producao'
}

export function baseUrl(): string {
  return BASES[ambiente()]
}

/** Todas as envs essenciais presentes e não-placeholder. Enquanto false, a lib não fala com o Inter. */
export function estaConfigurado(): boolean {
  return ESSENCIAIS.every((n) => pareceValor(bruto(n)))
}

/** Quais essenciais faltam — só os NOMES, para compor mensagens de erro sem vazar segredo. */
export function envsFaltando(): string[] {
  return ESSENCIAIS.filter((n) => !pareceValor(bruto(n)))
}

// Segredos OAuth (server-only). Nunca passam por logger/telemetria.
export function clientId(): string {
  return bruto('INTER_CLIENT_ID')
}
export function clientSecret(): string {
  return bruto('INTER_CLIENT_SECRET')
}

/** Conta-corrente para o header x-conta-corrente; null quando não configurada (usa a default do token). */
export function contaCorrente(): string | null {
  const v = bruto('INTER_CONTA_CORRENTE')
  return v || null
}

// Decodifica uma env base64 em PEM e confere que PARECE PEM. Buffer.from(base64)
// é leniente (ignora chars fora do alfabeto), então a validação real é a forma
// -----BEGIN/END-----, não a decodificação em si. Whitespace/newlines do
// `base64 -i arquivo` são tolerados. Erro cita a env, nunca o conteúdo.
function decodificarPem(nomeEnv: string): string {
  const b64 = bruto(nomeEnv)
  if (!pareceValor(b64)) throw new Error(`Inter: env ${nomeEnv} ausente ou placeholder`)
  const pem = Buffer.from(b64.replace(/\s+/g, ''), 'base64').toString('utf8')
  if (!/-----BEGIN [^-]+-----/.test(pem) || !/-----END [^-]+-----/.test(pem)) {
    throw new Error(`Inter: env ${nomeEnv} não decodifica para um PEM válido`)
  }
  return pem
}

/** Certificado do cliente (PEM) para o mTLS. Lança se ausente/inválido. */
export function certPem(): string {
  return decodificarPem('INTER_CERT_BASE64')
}

/** Chave privada do cliente (PEM) para o mTLS. Lança se ausente/inválida. */
export function keyPem(): string {
  return decodificarPem('INTER_KEY_BASE64')
}

/**
 * CA do Inter (PEM) para validar a origem dos webhooks — SÓ GUARDADO por ora,
 * o uso (validação de webhook) vem numa fase futura. null quando não configurada.
 */
export function webhookCaPem(): string | null {
  const b64 = bruto('INTER_WEBHOOK_CA_BASE64')
  if (!pareceValor(b64)) return null
  const pem = Buffer.from(b64.replace(/\s+/g, ''), 'base64').toString('utf8')
  return /-----BEGIN [^-]+-----/.test(pem) ? pem : null
}
