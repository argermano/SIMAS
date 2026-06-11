/**
 * Logger estruturado leve (sem dependências) com redação de campos sensíveis.
 * Emite JSON em uma linha por evento — pronto para coleta por APMs.
 *
 * Uso:
 *   import { logger } from '@/lib/logger'
 *   logger.info('contrato.assinatura.enviada', { contratoId, tenantId })
 *   logger.error('ia.gerar_peca.falha', { tenantId }, err)
 */

const CAMPOS_SENSIVEIS = new Set([
  'cpf', 'rg', 'password', 'senha', 'token', 'access_token', 'api_key', 'apikey',
  'authorization', 'secret', 'crypt_key', 'pins', 'pin', 'service_role_key',
  'encryption_key', 'signerresponses', 'cpf_cnpj',
])

function redact(value: unknown, depth = 0): unknown {
  if (depth > 5 || value == null) return value
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1))
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = CAMPOS_SENSIVEIS.has(k.toLowerCase()) ? '[REDACTED]' : redact(v, depth + 1)
    }
    return out
  }
  return value
}

type Nivel = 'debug' | 'info' | 'warn' | 'error'

function emit(nivel: Nivel, evento: string, contexto?: Record<string, unknown>, erro?: unknown) {
  const registro: Record<string, unknown> = {
    nivel,
    evento,
    ...(contexto ? (redact(contexto) as Record<string, unknown>) : {}),
  }
  if (erro !== undefined) {
    registro.erro = erro instanceof Error ? { message: erro.message, name: erro.name } : String(erro)
  }
  const linha = JSON.stringify(registro)
  if (nivel === 'error') console.error(linha)
  else if (nivel === 'warn') console.warn(linha)
  else console.log(linha)
}

export const logger = {
  debug: (evento: string, contexto?: Record<string, unknown>) => emit('debug', evento, contexto),
  info: (evento: string, contexto?: Record<string, unknown>) => emit('info', evento, contexto),
  warn: (evento: string, contexto?: Record<string, unknown>) => emit('warn', evento, contexto),
  error: (evento: string, contexto?: Record<string, unknown>, erro?: unknown) => emit('error', evento, contexto, erro),
}
