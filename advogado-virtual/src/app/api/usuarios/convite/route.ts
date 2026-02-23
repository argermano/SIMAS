import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { z } from 'zod'

const schema = z.object({
  nome:  z.string().min(2, 'Nome é obrigatório'),
  email: z.string().email('E-mail inválido'),
  role:  z.enum(['admin', 'advogado', 'colaborador']),
})

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

  // Envia e-mail de convite — cria o auth.user e retorna o ID
  const { data: convite, error: conviteError } = await adminSupabase.auth.admin.inviteUserByEmail(email, {
    data: { nome },
    redirectTo: `${process.env.NEXTAUTH_URL ?? 'http://localhost:3000'}/auth/callback?next=/definir-senha`,
  })

  if (conviteError) {
    // Se o usuário já existe no auth mas não no tenant, usa o ID existente
    if (!conviteError.message.includes('already been registered')) {
      return NextResponse.json({ error: `Erro ao enviar convite: ${conviteError.message}` }, { status: 500 })
    }
  }

  const authUserId = convite?.user?.id ?? null

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
