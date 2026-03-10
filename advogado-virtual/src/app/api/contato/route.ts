import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function POST(req: NextRequest) {
  try {
    const { nome, email, telefone } = await req.json() as {
      nome?: string
      email?: string
      telefone?: string
    }

    if (!nome?.trim() || !email?.trim()) {
      return NextResponse.json({ error: 'Nome e e-mail são obrigatórios' }, { status: 400 })
    }

    // Save contact to database (best effort — table may not exist yet)
    try {
      await supabaseAdmin.from('contatos_landing').insert({
        nome: nome.trim(),
        email: email.trim(),
        telefone: telefone?.trim() || null,
      })
    } catch (dbErr) {
      console.warn('[contato] DB insert failed:', dbErr)
    }

    // Send email via Resend if configured
    if (process.env.RESEND_API_KEY) {
      try {
        const { Resend } = await import('resend')
        const { emailTemplate } = await import('@/lib/email')
        const resend = new Resend(process.env.RESEND_API_KEY)
        await resend.emails.send({
          from: 'SIMAS <contato@simas.app>',
          to: 'argermano@gmail.com',
          subject: `Novo contato SIMAS — ${nome.trim()}`,
          html: emailTemplate({
            titulo: 'Novo contato via landing page',
            conteudo: `
              <table style="border-collapse:collapse;width:100%;">
                <tr><td style="padding:8px 12px;font-weight:600;color:#1e293b;width:100px;">Nome</td><td style="padding:8px 12px;color:#475569;">${nome.trim()}</td></tr>
                <tr style="background:#f8f9fc;"><td style="padding:8px 12px;font-weight:600;color:#1e293b;">E-mail</td><td style="padding:8px 12px;color:#475569;">${email.trim()}</td></tr>
                <tr><td style="padding:8px 12px;font-weight:600;color:#1e293b;">Telefone</td><td style="padding:8px 12px;color:#475569;">${telefone?.trim() || '—'}</td></tr>
              </table>
            `,
            rodape: 'Enviado via formulário de contato da página de login do SIMAS.',
          }),
        })
      } catch (mailErr) {
        console.warn('[contato] Email send failed:', mailErr)
      }
    }

    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[contato]', err)
    return NextResponse.json({ error: 'Erro ao enviar mensagem' }, { status: 500 })
  }
}
