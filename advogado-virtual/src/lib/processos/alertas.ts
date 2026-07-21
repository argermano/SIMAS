/**
 * Alertas de falha do pipeline de Publicações/Intimações (DJEN).
 *
 * Canal interno para a operação do escritório: e-mail (Resend) + Sentry.
 * É um efeito colateral de observabilidade — NUNCA lança, para não derrubar
 * o cron/pipeline que o chamou.
 *
 * LGPD: o parâmetro `detalhes` deve conter apenas ids/hashes/contagens/mensagens
 * de erro — NUNCA o texto integral de publicações.
 *
 * (WhatsApp interno de alerta é Lote 3 — não implementado aqui.)
 */

import * as Sentry from '@sentry/nextjs'
import { enviarEmail, emailTemplate } from '@/lib/email'
import { logger } from '@/lib/logger'

/** Escapa texto para interpolação segura no HTML do e-mail (evita quebrar o <pre>). */
function escaparHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string
  ))
}

/**
 * Notifica a operação sobre uma falha na captura de publicações.
 *
 * Envia e-mail para `CONTACT_REPLY_EMAIL` (fallback 'argermano@gmail.com') e
 * registra a exceção no Sentry (no-op sem `SENTRY_DSN`). Nunca lança: qualquer
 * erro de envio é apenas logado.
 */
export async function alertarFalhaPublicacoes(params: { assunto: string; detalhes: string }): Promise<void> {
  const { assunto, detalhes } = params
  try {
    // Sentry: agrupa por assunto; detalhes como contexto (sem PII de publicações).
    Sentry.captureException(new Error(`captura de publicações: ${assunto}`), {
      extra: { assunto, detalhes },
    })
  } catch (err) {
    // Chave 'alerta' (não 'assunto'): 'assunto' é redigido pelo logger (rede LGPD);
    // aqui é só o título operacional da falha, que precisa continuar visível.
    logger.error('publicacoes.alerta.sentry_falha', { alerta: assunto }, err)
  }

  try {
    const para = process.env.CONTACT_REPLY_EMAIL ?? 'argermano@gmail.com'
    await enviarEmail({
      para,
      assunto: '⚠️ Falha na captura de publicações — SIMAS',
      html: emailTemplate({
        titulo: '⚠️ Falha na captura de publicações — SIMAS',
        conteudo: `
          <p>O pipeline de captura de publicações do DJEN reportou uma falha:</p>
          <p style="margin:0 0 6px;"><strong>${escaparHtml(assunto)}</strong></p>
          <pre style="margin:12px 0 0;padding:12px 14px;background:#f8f9fc;border:1px solid #e8eaf0;border-radius:6px;color:#475569;font-size:12px;line-height:1.6;white-space:pre-wrap;word-break:break-word;overflow-x:auto;">${escaparHtml(detalhes)}</pre>
        `,
        rodape: 'Alerta automático do módulo de Publicações do SIMAS.',
      }),
    })
  } catch (err) {
    // enviarEmail já não lança, mas blindamos o contrato "nunca lança" mesmo assim.
    // Chave 'alerta' (não 'assunto') para escapar da redação do logger — ver acima.
    logger.error('publicacoes.alerta.email_falha', { alerta: assunto }, err)
  }
}
