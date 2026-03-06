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
        const resend = new Resend(process.env.RESEND_API_KEY)
        await resend.emails.send({
          from: 'SIMAS <contato@simas.app>',
          to: 'argermano@gmail.com',
          subject: `Novo contato SIMAS — ${nome.trim()}`,
          html: `
            <h2>Novo contato via SIMAS</h2>
            <table style="border-collapse:collapse;font-family:sans-serif;">
              <tr><td style="padding:6px 12px;font-weight:bold;">Nome</td><td style="padding:6px 12px;">${nome.trim()}</td></tr>
              <tr><td style="padding:6px 12px;font-weight:bold;">E-mail</td><td style="padding:6px 12px;">${email.trim()}</td></tr>
              <tr><td style="padding:6px 12px;font-weight:bold;">Telefone</td><td style="padding:6px 12px;">${telefone?.trim() || '—'}</td></tr>
            </table>
            <p style="margin-top:16px;color:#666;font-size:13px;">Enviado via formulário de contato da página de login.</p>
          `,
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
