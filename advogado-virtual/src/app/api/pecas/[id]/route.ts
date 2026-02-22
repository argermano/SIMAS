import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

// DELETE /api/pecas/[id] — exclui peça e versões relacionadas
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })

  const { data: usuario } = await supabase
    .from('users')
    .select('tenant_id')
    .eq('auth_user_id', user.id)
    .single()

  if (!usuario) return NextResponse.json({ error: 'Usuário não encontrado' }, { status: 404 })

  // Verificar que a peça pertence ao tenant
  const { data: peca } = await supabase
    .from('pecas')
    .select('id')
    .eq('id', id)
    .eq('tenant_id', usuario.tenant_id)
    .single()

  if (!peca) {
    return NextResponse.json({ error: 'Peça não encontrada' }, { status: 404 })
  }

  // Excluir versões primeiro
  await supabase.from('pecas_versoes').delete().eq('peca_id', id)

  // Excluir a peça
  const { error } = await supabase
    .from('pecas')
    .delete()
    .eq('id', id)
    .eq('tenant_id', usuario.tenant_id)

  if (error) {
    return NextResponse.json({ error: 'Erro ao excluir peça' }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}
