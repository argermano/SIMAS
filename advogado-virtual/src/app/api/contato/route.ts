import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

// Fallback nas envs para o createClient não LANÇAR no build quando as envs do
// Supabase não estão presentes (ex.: ambiente de Preview). Em runtime o módulo é
// reavaliado com as envs reais (cold start), então usa as credenciais corretas.
const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'https://placeholder.supabase.co',
  process.env.SUPABASE_SERVICE_ROLE_KEY ?? 'placeholder-key',
)

// Rate limiting in-memory (best-effort; por instância em ambiente serverless).
// Para limite global robusto, migrar para Upstash Redis.
const RATE_LIMIT_MAX = 5
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000 // 1 hora
const acessosPorIp = new Map<string, number[]>()

function rateLimited(ip: string): boolean {
  const agora = Date.now()
  const inicioJanela = agora - RATE_LIMIT_WINDOW_MS
  const hits = (acessosPorIp.get(ip) ?? []).filter((t) => t > inicioJanela)
  hits.push(agora)
  acessosPorIp.set(ip, hits)
  // Limpeza oportunista para não crescer indefinidamente
  if (acessosPorIp.size > 5000) {
    for (const [k, v] of acessosPorIp) {
      if (v.every((t) => t <= inicioJanela)) acessosPorIp.delete(k)
    }
  }
  return hits.length > RATE_LIMIT_MAX
}

export async function POST(req: NextRequest) {
  try {
    const { nome, email, telefone, website } = await req.json() as {
      nome?: string
      email?: string
      telefone?: string
      website?: string // honeypot — deve vir vazio
    }

    // Honeypot: bots preenchem campos ocultos. Finge sucesso sem processar.
    if (website && website.trim()) {
      return NextResponse.json({ ok: true })
    }

    // Rate limiting por IP
    const ip =
      req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
      req.headers.get('x-real-ip') ||
      'desconhecido'
    if (rateLimited(ip)) {
      return NextResponse.json(
        { error: 'Muitas tentativas. Aguarde alguns minutos e tente novamente.' },
        { status: 429 }
      )
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
          to: process.env.CONTACT_REPLY_EMAIL ?? 'argermano@gmail.com',
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
