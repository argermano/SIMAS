import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { z } from 'zod'

const schema = z.object({
  role:   z.enum(['admin', 'advogado', 'colaborador']).optional(),
  status: z.enum(['ativo', 'inativo']).optional(),
}).refine(data => data.role || data.status, { message: 'Informe role ou status' })

// PATCH /api/usuarios/[id] — atualiza role ou status (admin only)
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })

  const { data: admin } = await supabase
    .from('users')
    .select('id, tenant_id, role')
    .eq('auth_user_id', user.id)
    .single()

  if (!admin) return NextResponse.json({ error: 'Usuário não encontrado' }, { status: 404 })
  if (admin.role !== 'admin') return NextResponse.json({ error: 'Apenas administradores podem alterar perfis' }, { status: 403 })

  // Admin não pode alterar o próprio role
  if (id === admin.id) {
    return NextResponse.json({ error: 'Você não pode alterar seu próprio perfil' }, { status: 400 })
  }

  const body = await req.json()
  const resultado = schema.safeParse(body)
  if (!resultado.success) {
    return NextResponse.json({ error: 'Dados inválidos', detalhes: resultado.error.flatten() }, { status: 400 })
  }

  const { data: usuario, error } = await supabase
    .from('users')
    .update(resultado.data)
    .eq('id', id)
    .eq('tenant_id', admin.tenant_id)
    .select('id, nome, email, role, status')
    .single()

  if (error || !usuario) {
    return NextResponse.json({ error: 'Usuário não encontrado' }, { status: 404 })
  }

  return NextResponse.json({ ok: true, usuario })
}

// DELETE /api/usuarios/[id] — remove usuário do escritório (admin only)
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })

  const { data: admin } = await supabase
    .from('users')
    .select('id, tenant_id, role')
    .eq('auth_user_id', user.id)
    .single()

  if (!admin) return NextResponse.json({ error: 'Usuário não encontrado' }, { status: 404 })
  if (admin.role !== 'admin') return NextResponse.json({ error: 'Apenas administradores podem remover usuários' }, { status: 403 })
  if (id === admin.id) return NextResponse.json({ error: 'Você não pode remover a si mesmo' }, { status: 400 })

  const { error } = await supabase
    .from('users')
    .update({ status: 'inativo' })
    .eq('id', id)
    .eq('tenant_id', admin.tenant_id)

  if (error) return NextResponse.json({ error: 'Erro ao remover usuário' }, { status: 500 })

  return NextResponse.json({ ok: true })
}
