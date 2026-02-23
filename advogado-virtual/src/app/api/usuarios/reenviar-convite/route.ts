import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { z } from 'zod'

const schema = z.object({
  email: z.string().email('E-mail inválido'),
})

// POST /api/usuarios/reenviar-convite — reenvia o e-mail de convite (admin only)
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
  if (admin.role !== 'admin') return NextResponse.json({ error: 'Apenas administradores podem reenviar convites' }, { status: 403 })

  const body = await req.json()
  const resultado = schema.safeParse(body)
  if (!resultado.success) {
    return NextResponse.json({ error: 'E-mail inválido' }, { status: 400 })
  }

  const { email } = resultado.data

  // Verifica que o e-mail pertence a um usuário pendente do mesmo tenant
  const { data: pendente } = await supabase
    .from('users')
    .select('id, auth_user_id')
    .eq('email', email)
    .eq('tenant_id', admin.tenant_id)
    .eq('status', 'ativo')
    .single()

  if (!pendente) {
    return NextResponse.json({ error: 'Usuário não encontrado neste escritório' }, { status: 404 })
  }

  const adminSupabase = createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  const { error } = await adminSupabase.auth.admin.inviteUserByEmail(email, {
    redirectTo: `${process.env.NEXTAUTH_URL ?? 'http://localhost:3000'}/auth/callback?next=/definir-senha`,
  })

  if (error && !error.message.includes('already been registered')) {
    return NextResponse.json({ error: `Erro ao reenviar convite: ${error.message}` }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}
