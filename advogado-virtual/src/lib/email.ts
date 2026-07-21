/**
 * Template de e-mail com identidade visual SIMAS
 * Cores: primary #4f5fcc (índigo), foreground #1e293b, muted #94a3b8
 */

import { logger } from './logger'

interface EmailTemplateOptions {
  titulo: string
  conteudo: string
  botao?: { texto: string; url: string }
  rodape?: string
}

export function emailTemplate({ titulo, conteudo, botao, rodape }: EmailTemplateOptions): string {
  return `
<!DOCTYPE html>
<html lang="pt-BR">
<head><meta charset="UTF-8" /></head>
<body style="margin:0;padding:0;background-color:#f1f3f9;font-family:'Segoe UI',Roboto,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#f1f3f9;padding:32px 16px;">
    <tr><td align="center">
      <table width="520" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.06);">
        <!-- Header -->
        <tr>
          <td style="background:linear-gradient(135deg,#4f5fcc,#6b78e0);padding:28px 32px;text-align:center;">
            <span style="font-size:28px;font-weight:800;color:#fff;letter-spacing:1px;">SIMAS</span>
            <br/>
            <span style="font-size:11px;color:rgba(255,255,255,0.7);letter-spacing:2px;text-transform:uppercase;">Sistema de IA para Advocacia</span>
          </td>
        </tr>
        <!-- Body -->
        <tr>
          <td style="padding:32px;">
            <h2 style="margin:0 0 16px;color:#1e293b;font-size:20px;font-weight:600;">${titulo}</h2>
            <div style="color:#475569;font-size:15px;line-height:1.7;">
              ${conteudo}
            </div>
            ${botao ? `
            <div style="text-align:center;margin:28px 0 8px;">
              <a href="${botao.url}" style="background-color:#4f5fcc;color:#fff;padding:13px 36px;border-radius:8px;text-decoration:none;font-weight:600;font-size:15px;display:inline-block;">
                ${botao.texto}
              </a>
            </div>
            <p style="text-align:center;margin:12px 0 0;">
              <a href="${botao.url}" style="color:#4f5fcc;font-size:12px;word-break:break-all;">${botao.url}</a>
            </p>
            ` : ''}
          </td>
        </tr>
        <!-- Footer -->
        <tr>
          <td style="padding:20px 32px;background:#f8f9fc;border-top:1px solid #e8eaf0;">
            <p style="margin:0;color:#94a3b8;font-size:12px;text-align:center;">
              ${rodape || 'Este é um e-mail automático do SIMAS. Não responda a esta mensagem.'}
            </p>
            <p style="margin:8px 0 0;color:#cbd5e1;font-size:11px;text-align:center;">
              &copy; ${new Date().getFullYear()} SIMAS &middot; Dados protegidos pela LGPD
            </p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`
}

/** Escapa texto do usuário antes de interpolar no HTML do e-mail. */
export function escaparHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string
  ))
}

/**
 * URL base pública do app para montar links absolutos em e-mails e feeds.
 * Prioridade: NEXTAUTH_URL (config explícita) → em produção na Vercel o domínio
 * canônico → VERCEL_URL (deploys de preview) → localhost (só em dev).
 * Nunca cai em localhost em produção: um link localhost num e-mail de convite
 * é inútil para quem recebe.
 */
function baseUrl(): string {
  if (process.env.NEXTAUTH_URL) return process.env.NEXTAUTH_URL
  if (process.env.VERCEL_ENV === 'production') return 'https://simas.app'
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`
  return 'http://localhost:3000'
}

/**
 * Mascara o destinatário para log. LGPD: o assunto costuma trazer nome de
 * pessoa e o e-mail é dado pessoal — logamos só a inicial do local + domínio,
 * ou 'ausente' quando não há destinatário.
 */
function mascararEmail(email: string | undefined): string {
  const e = (email ?? '').trim()
  if (!e) return 'ausente'
  const at = e.indexOf('@')
  if (at <= 0) return '***'
  return `${e[0]}***@${e.slice(at + 1)}`
}

/**
 * Envia um e-mail via Resend. Retorna `true` se saiu, `false` se não há
 * RESEND_API_KEY (feature desligada) ou se o envio falhou — nunca lança, para
 * não derrubar a operação principal (a notificação é um efeito colateral).
 */
export async function enviarEmail(opts: { para: string; assunto: string; html: string }): Promise<boolean> {
  if (!process.env.RESEND_API_KEY) {
    logger.warn('email.resend_ausente', { destinatario: mascararEmail(opts.para) })
    return false
  }
  try {
    const { Resend } = await import('resend')
    const resend = new Resend(process.env.RESEND_API_KEY)
    await resend.emails.send({
      from: 'SIMAS <contato@simas.app>',
      to: opts.para,
      subject: opts.assunto,
      html: opts.html,
    })
    return true
  } catch (err) {
    logger.error('email.envio_falha', { destinatario: mascararEmail(opts.para) }, err)
    return false
  }
}

interface NotificacaoPeca {
  para: string
  nomeAutor: string
  descricaoPeca: string   // ex.: "Petição Inicial (Previdenciário)"
  cliente?: string | null
  pecaUrl: string
}

/** Notifica o autor de que sua peça foi APROVADA na revisão. */
export function enviarEmailPecaAprovada(n: NotificacaoPeca): Promise<boolean> {
  const cli = n.cliente ? ` do cliente <strong>${escaparHtml(n.cliente)}</strong>` : ''
  return enviarEmail({
    para: n.para,
    assunto: 'Sua peça foi aprovada ✓',
    html: emailTemplate({
      titulo: `Peça aprovada, ${escaparHtml(n.nomeAutor)}!`,
      conteudo: `
        <p>Boa notícia: sua peça <strong>${escaparHtml(n.descricaoPeca)}</strong>${cli} foi <strong>aprovada</strong> na revisão.</p>
        <p>Ela já está liberada como rascunho para finalização e exportação.</p>
      `,
      botao: { texto: 'Abrir a peça', url: n.pecaUrl },
    }),
  })
}

/** Notifica o autor de que sua peça foi DEVOLVIDA (rejeitada), com o motivo. */
export function enviarEmailPecaRejeitada(n: NotificacaoPeca & { motivo: string }): Promise<boolean> {
  const cli = n.cliente ? ` do cliente <strong>${escaparHtml(n.cliente)}</strong>` : ''
  return enviarEmail({
    para: n.para,
    assunto: 'Sua peça precisa de ajustes',
    html: emailTemplate({
      titulo: 'Peça devolvida para ajustes',
      conteudo: `
        <p>Olá, ${escaparHtml(n.nomeAutor)}. Sua peça <strong>${escaparHtml(n.descricaoPeca)}</strong>${cli} foi <strong>devolvida</strong> na revisão.</p>
        <p style="margin:16px 0 6px;"><strong>Motivo apontado pelo revisor:</strong></p>
        <blockquote style="margin:0;padding:12px 16px;border-left:3px solid #4f5fcc;background:#f8f9fc;color:#475569;border-radius:6px;">
          ${escaparHtml(n.motivo)}
        </blockquote>
        <p style="margin-top:16px;">Revise os pontos e reenvie a peça para nova revisão.</p>
      `,
      botao: { texto: 'Abrir a peça', url: n.pecaUrl },
    }),
  })
}

interface MencaoComentario {
  para: string            // e-mail do mencionado
  nomeMencionado: string
  nomeAutor: string       // quem mencionou
  tarefa: string          // descrição da tarefa (contexto)
  conteudo: string        // texto do comentário
}

/**
 * Notifica um colega mencionado (@) em um comentário de tarefa. Best-effort:
 * herda o comportamento de enviarEmail (não lança; desligado sem RESEND_API_KEY).
 */
export function enviarEmailMencaoComentario(n: MencaoComentario): Promise<boolean> {
  return enviarEmail({
    para: n.para,
    assunto: `${n.nomeAutor} mencionou você em uma tarefa`,
    html: emailTemplate({
      titulo: `Você foi mencionado, ${escaparHtml(n.nomeMencionado)}`,
      conteudo: `
        <p><strong>${escaparHtml(n.nomeAutor)}</strong> mencionou você em um comentário na tarefa <strong>${escaparHtml(n.tarefa)}</strong>:</p>
        <blockquote style="margin:16px 0;padding:12px 16px;border-left:3px solid #4f5fcc;background:#f8f9fc;color:#475569;border-radius:6px;white-space:pre-wrap;">
          ${escaparHtml(n.conteudo)}
        </blockquote>
      `,
      botao: { texto: 'Abrir tarefas', url: `${baseUrl()}/tarefas` },
    }),
  })
}

export { baseUrl as urlBaseApp }