import { NextRequest, NextResponse } from 'next/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { z } from 'zod'
import { getAuthContext } from '@/lib/auth'
import { jsonError } from '@/lib/api'
import { logAudit } from '@/lib/audit'

const schema = z.object({
  email: z.string().email('E-mail inválido'),
})

import { emailTemplate, urlBaseApp } from '@/lib/email'

async function enviarEmailAcesso(nome: string, email: string, link: string, isNovo: boolean) {
  if (!process.env.RESEND_API_KEY) {
    console.warn('[reenviar-convite] RESEND_API_KEY não configurada — e-mail não enviado')
    return
  }
  const { Resend } = await import('resend')
  const resend = new Resend(process.env.RESEND_API_KEY)
  await resend.emails.send({
    from: 'SIMAS <contato@simas.app>',
    to: email,
    subject: isNovo ? 'Convite para acessar o SIMAS' : 'Seu link de acesso ao SIMAS',
    html: emailTemplate({
      titulo: `Olá, ${nome}!`,
      conteudo: isNovo
        ? `
          <p>Você foi convidado(a) para acessar o <strong>SIMAS</strong> — Sistema Inteligente para Modernizar a Advocacia com Segurança.</p>
          <p>Clique no botão abaixo para criar sua senha e começar a usar o sistema:</p>
        `
        : `
          <p>Você recebeu um novo link para acessar o <strong>SIMAS</strong>.</p>
          <p>Clique no botão abaixo para definir sua senha e entrar no sistema:</p>
        `,
      botao: { texto: isNovo ? 'Criar minha senha' : 'Definir minha senha', url: link },
      rodape: 'Este link expira em 24 horas. Se você não solicitou este acesso, ignore este e-mail.',
    }),
  })
}

// POST /api/usuarios/reenviar-convite — reenvia o e-mail de convite (admin only)
export async function POST(req: NextRequest) {
  const auth = await getAuthContext()
  if (!auth.ok) return auth.response
  const { supabase, usuario } = auth

  if (usuario.role !== 'admin') return jsonError('Apenas administradores podem reenviar convites', 403)

  const body = await req.json()
  const resultado = schema.safeParse(body)
  if (!resultado.success) {
    return jsonError('E-mail inválido', 400)
  }

  const { email } = resultado.data

  // Verifica que o e-mail pertence a um usuário do mesmo tenant
  const { data: pendente } = await supabase
    .from('users')
    .select('id, nome, auth_user_id')
    .eq('email', email)
    .eq('tenant_id', usuario.tenant_id)
    .eq('status', 'ativo')
    .single()

  if (!pendente) {
    return jsonError('Usuário não encontrado neste escritório', 404)
  }

  const adminSupabase = createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  const baseUrl = urlBaseApp()

  // Se o usuário já tem conta, usa recovery (permite definir senha); senão, invite
  const linkType = pendente.auth_user_id ? 'recovery' : 'invite'
  const redirectPath = '/definir-senha'

  const { data: linkData, error } = await adminSupabase.auth.admin.generateLink({
    type: linkType,
    email,
    options: {
      redirectTo: `${baseUrl}/auth/callback?next=${redirectPath}`,
    },
  })

  if (error) {
    console.error('[reenviar-convite] Erro generateLink:', error.message)
    return jsonError(`Erro ao gerar link: ${error.message}`, 500)
  }

  if (!linkData?.properties?.action_link) {
    return jsonError('Não foi possível gerar o link de acesso', 500)
  }

  // Envia e-mail personalizado via Resend
  const nome = pendente.nome || 'Usuário'
  const isNovo = !pendente.auth_user_id
  try {
    await enviarEmailAcesso(nome, email, linkData.properties.action_link, isNovo)
  } catch (mailErr) {
    console.error('[reenviar-convite] Erro ao enviar e-mail:', mailErr)
    return jsonError('Erro ao enviar e-mail', 500)
  }

  await logAudit({
    tenantId: usuario.tenant_id,
    userId: usuario.id,
    action: 'user.invite_resend',
    resourceType: 'user',
    resourceId: pendente.id,
  })

  return NextResponse.json({ ok: true })
}
