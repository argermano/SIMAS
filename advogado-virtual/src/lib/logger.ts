/**
 * Logger estruturado leve (sem dependências) com redação de campos sensíveis.
 * Emite JSON em uma linha por evento — pronto para coleta por APMs.
 *
 * Uso:
 *   import { logger } from '@/lib/logger'
 *   logger.info('contrato.assinatura.enviada', { contratoId, tenantId })
 *   logger.error('ia.gerar_peca.falha', { tenantId }, err)
 */

// Rede de segurança de defesa em profundidade: a regra principal continua sendo
// logar só ids/códigos/contagens. Estas chaves são redigidas mesmo assim, caso
// algum chamador futuro embuta PII no contexto. Chaves sobrecarregadas (ex.:
// 'nome', 'name', 'assunto') também aparecem em logs legítimos NÃO-pessoais —
// nesses pontos de chamada renomeie a chave para algo não-pessoal (ex.: 'arquivo',
// 'alerta') em vez de deixar a PII passar, para não cegar o diagnóstico.
const CAMPOS_SENSIVEIS = new Set([
  'cpf', 'rg', 'password', 'senha', 'token', 'access_token', 'api_key', 'apikey',
  'authorization', 'secret', 'crypt_key', 'pins', 'pin', 'service_role_key',
  'encryption_key', 'signerresponses', 'cpf_cnpj',
  // PII de contato/identificação (LGPD)
  'telefone', 'phone', 'celular', 'whatsapp', 'email', 'e_mail', 'e-mail',
  'endereco', 'nome', 'name',
  // Texto livre que pode carregar PII (assunto/corpo de e-mail, mensagens)
  'assunto', 'subject', 'mensagem', 'message', 'texto', 'body', 'conteudo',
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
