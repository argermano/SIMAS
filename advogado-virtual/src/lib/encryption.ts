import crypto from 'node:crypto'

/**
 * Criptografia de campos sensíveis (CPF/RG) em repouso — AES-256-GCM.
 *
 * Formato do ciphertext: `enc:v1:<iv_b64>:<tag_b64>:<dados_b64>`
 * O prefixo `enc:v1:` permite que decryptField() distinga valores cifrados de
 * texto-plano legado (compatibilidade: dados antigos passam intactos na leitura).
 *
 * Comportamento sem ENCRYPTION_KEY válida: encryptField() devolve o texto-plano
 * sem alteração (com aviso). Isso torna a introdução desta camada NEUTRA até que
 * a chave seja provisionada — nenhuma regressão antes disso.
 *
 * Gere a chave com:  openssl rand -hex 32   (64 caracteres hexadecimais)
 */

const PREFIX = 'enc:v1:'
const ALGO = 'aes-256-gcm'

let keyCache: Buffer | null | undefined // undefined = ainda não resolvido
let avisouSemChave = false

function getKey(): Buffer | null {
  if (keyCache !== undefined) return keyCache

  const raw = process.env.ENCRYPTION_KEY
  // Trata ausência e o placeholder do .env.local.example como "não configurada"
  if (!raw || raw.includes('gere_com')) {
    keyCache = null
    return null
  }

  // Preferencial: 64 chars hex = 32 bytes. Senão, deriva 32 bytes via SHA-256.
  keyCache = /^[0-9a-fA-F]{64}$/.test(raw)
    ? Buffer.from(raw, 'hex')
    : crypto.createHash('sha256').update(raw).digest()

  return keyCache
}

/** Indica se há uma chave de criptografia utilizável configurada. */
export function isEncryptionConfigured(): boolean {
  return getKey() !== null
}

/** Criptografa um valor. Retorna null/undefined inalterado; passa texto-plano se não houver chave. */
export function encryptField<T extends string | null | undefined>(plain: T): T | string {
  if (plain == null || plain === '') return plain
  const key = getKey()
  if (!key) {
    if (!avisouSemChave) {
      console.warn('[encryption] ENCRYPTION_KEY ausente — CPF/RG sendo gravados em texto-plano.')
      avisouSemChave = true
    }
    return plain
  }
  // Já cifrado? não cifrar de novo (idempotência)
  if (typeof plain === 'string' && plain.startsWith(PREFIX)) return plain

  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv(ALGO, key, iv)
  const enc = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return `${PREFIX}${iv.toString('base64')}:${tag.toString('base64')}:${enc.toString('base64')}`
}

/** Descriptografa um valor. Texto-plano legado (sem prefixo) é devolvido intacto. */
export function decryptField<T extends string | null | undefined>(value: T): T | string {
  if (value == null || value === '') return value
  if (typeof value !== 'string' || !value.startsWith(PREFIX)) return value

  const key = getKey()
  if (!key) return value // sem chave não há como decifrar; devolve como está

  try {
    const [, , ivB64, tagB64, dataB64] = value.split(':')
    const iv = Buffer.from(ivB64, 'base64')
    const tag = Buffer.from(tagB64, 'base64')
    const data = Buffer.from(dataB64, 'base64')
    const decipher = crypto.createDecipheriv(ALGO, key, iv)
    decipher.setAuthTag(tag)
    const dec = Buffer.concat([decipher.update(data), decipher.final()])
    return dec.toString('utf8')
  } catch (err) {
    console.error('[encryption] falha ao decifrar campo:', err instanceof Error ? err.message : err)
    return value
  }
}

/** Campos sensíveis de um cliente que são criptografados em repouso. */
const CAMPOS_SENSIVEIS = ['cpf', 'rg'] as const

/**
 * Campos de transcrição do atendimento cifrados em repouso. O relato do cliente
 * é dado pessoal — na área médica inclui diagnósticos e histórico de saúde
 * (dado sensível, LGPD Art. 11). Mesma retrocompatibilidade: sem chave, passa
 * texto-plano; leitura de dados legados (sem prefixo) é devolvida intacta.
 */
const CAMPOS_TRANSCRICAO = ['transcricao_raw', 'transcricao_editada'] as const

/** Cifra os campos de transcrição de um objeto de atendimento (cópia). */
export function encryptTranscricaoFields<T extends Record<string, unknown>>(obj: T): T {
  const out: Record<string, unknown> = { ...obj }
  for (const campo of CAMPOS_TRANSCRICAO) {
    if (campo in out && typeof out[campo] === 'string') {
      out[campo] = encryptField(out[campo] as string)
    }
  }
  return out as T
}

/** Decifra os campos de transcrição de um objeto de atendimento (cópia). */
export function decryptTranscricaoFields<T extends Record<string, unknown> | null | undefined>(obj: T): T {
  if (!obj) return obj
  const out: Record<string, unknown> = { ...obj }
  for (const campo of CAMPOS_TRANSCRICAO) {
    if (campo in out && typeof out[campo] === 'string') {
      out[campo] = decryptField(out[campo] as string)
    }
  }
  return out as T
}

/** Cifra os campos sensíveis (cpf/rg) de um objeto de cliente, retornando uma cópia. */
export function encryptClienteFields<T extends Record<string, unknown>>(obj: T): T {
  const out: Record<string, unknown> = { ...obj }
  for (const campo of CAMPOS_SENSIVEIS) {
    if (campo in out && typeof out[campo] === 'string') {
      out[campo] = encryptField(out[campo] as string)
    }
  }
  return out as T
}

/** Decifra os campos sensíveis (cpf/rg) de um objeto de cliente, retornando uma cópia. */
export function decryptClienteFields<T extends Record<string, unknown> | null | undefined>(obj: T): T {
  if (!obj) return obj
  const out: Record<string, unknown> = { ...obj }
  for (const campo of CAMPOS_SENSIVEIS) {
    if (campo in out && typeof out[campo] === 'string') {
      out[campo] = decryptField(out[campo] as string)
    }
  }
  return out as T
}
