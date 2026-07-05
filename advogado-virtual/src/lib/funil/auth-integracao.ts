import { timingSafeEqual, createHmac } from 'crypto'

/**
 * Autoriza chamadas do ai-attendant via header x-simas-token comparado a
 * SIMAS_INTEGRATION_TOKEN. Fail-closed: sem o token no ambiente → nega.
 */
export function autorizadoIntegracao(req: Request): boolean {
  const esperado = process.env.SIMAS_INTEGRATION_TOKEN
  if (!esperado) return false
  const recebido = req.headers.get('x-simas-token') ?? ''
  const a = Buffer.from(recebido)
  const b = Buffer.from(esperado)
  return a.length === b.length && timingSafeEqual(a, b)
}

/**
 * Verifica a assinatura HMAC-SHA256 do webhook Cal.com sobre o CORPO BRUTO,
 * comparada (timingSafeEqual) ao header x-cal-signature-256. Fail-closed.
 */
export function assinaturaCalcomValida(corpoBruto: string, header: string | null): boolean {
  const secret = process.env.CALCOM_WEBHOOK_SECRET
  if (!secret || !header) return false
  const esperado = createHmac('sha256', secret).update(corpoBruto).digest('hex')
  const a = Buffer.from(header)
  const b = Buffer.from(esperado)
  return a.length === b.length && timingSafeEqual(a, b)
}
