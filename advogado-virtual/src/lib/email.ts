/**
 * Template de e-mail com identidade visual SIMAS
 * Cores: primary #4f5fcc (índigo), foreground #1e293b, muted #94a3b8
 */

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