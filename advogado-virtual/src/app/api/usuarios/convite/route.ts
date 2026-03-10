import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { z } from 'zod'

const schema = z.object({
  nome:  z.string().min(2, 'Nome é obrigatório'),
  email: z.string().email('E-mail inválido'),
  role:  z.enum(['admin', 'advogado', 'colaborador']),
})

import { emailTemplate } from '@/lib/email'

async function enviarEmailConvite(nome: string, email: string, link: string) {
  if (!process.env.RESEND_API_KEY) {
    console.warn('[convite] RESEND_API_KEY não configurada — e-mail não enviado')
    return
  }
  const { Resend } = await import('resend')
  const resend = new Resend(process.env.RESEND_API_KEY)
  await resend.emails.send({
    from: 'SIMAS <contato@simas.app>',
    to: email,
    subject: 'Convite para acessar o SIMAS',
    html: emailTemplate({
      titulo: `Olá, ${nome}!`,
      conteudo: `
        <p>Você foi convidado(a) para acessar o <strong>SIMAS</strong> — Sistema de IA para Maximizar a Advocacia de forma Simples.</p>
        <p>Clique no botão abaixo para criar sua senha e começar a usar o sistema:</p>
      `,
      botao: { texto: 'Criar minha senha', url: link },
      rodape: 'Este link expira em 24 horas. Se você não solicitou este acesso, ignore este e-mail.',
    }),
  })
}

// POST /api/usuarios/convite — convida usuário para o escritório (admin only)
export async function POST(req: NextRequest) {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })

  const { data: admin } = await supabase
    .from('users')
    .select('id, tenant_id, role')
    .eq('auth_user_id', user.id)
    .single()

  if (!admin) return NextResponse.json({ error: 'Usuário não encontrado' }, { status: 404 })
  if (admin.role !== 'admin') return NextResponse.json({ error: 'Apenas administradores podem convidar usuários' }, { status: 403 })

  const body = await req.json()
  const resultado = schema.safeParse(body)
  if (!resultado.success) {
    return NextResponse.json({ error: 'Dados inválidos', detalhes: resultado.error.flatten() }, { status: 400 })
  }

  const { nome, email, role } = resultado.data

  // Verifica se já existe um usuário com este e-mail no tenant
  const { data: existente } = await supabase
    .from('users')
    .select('id')
    .eq('email', email)
    .eq('tenant_id', admin.tenant_id)
    .single()

  if (existente) {
    return NextResponse.json({ error: 'Este e-mail já está cadastrado no escritório' }, { status: 409 })
  }

  // Usa service role key para chamar a API administrativa do Supabase Auth
  const adminSupabase = createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  const baseUrl = process.env.NEXTAUTH_URL ?? 'http://localhost:3000'

  // Gera link de convite sem enviar email (Supabase gera o token, nós enviamos via Resend)
  const { data: linkData, error: linkError } = await adminSupabase.auth.admin.generateLink({
    type: 'invite',
    email,
    options: {
      data: { nome },
      redirectTo: `${baseUrl}/auth/callback?next=/definir-senha`,
    },
  })

  if (linkError) {
    if (!linkError.message.includes('already been registered')) {
      return NextResponse.json({ error: `Erro ao gerar convite: ${linkError.message}` }, { status: 500 })
    }
  }

  const authUserId = linkData?.user?.id ?? null

  // Envia e-mail personalizado via Resend
  if (linkData?.properties?.action_link) {
    try {
      await enviarEmailConvite(nome, email, linkData.properties.action_link)
    } catch (mailErr) {
      console.error('[convite] Erro ao enviar e-mail:', mailErr)
    }
  }

  // Cria o registro na tabela users (vinculado ao tenant do admin)
  const { data: novoUsuario, error: userError } = await adminSupabase
    .from('users')
    .insert({
      tenant_id:    admin.tenant_id,
      auth_user_id: authUserId,
      nome,
      email,
      role,
      status: 'ativo',
    })
    .select('id, nome, email, role, status, created_at')
    .single()

  if (userError) {
    return NextResponse.json({ error: `Erro ao criar usuário: ${userError.message}` }, { status: 500 })
  }

  return NextResponse.json({ ok: true, usuario: novoUsuario }, { status: 201 })
}
