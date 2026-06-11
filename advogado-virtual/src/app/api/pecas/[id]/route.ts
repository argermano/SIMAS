import { NextResponse } from 'next/server'
import { getAuthContext } from '@/lib/auth'
import { jsonError } from '@/lib/api'

// DELETE /api/pecas/[id] — exclui peça e versões relacionadas
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params

  const auth = await getAuthContext()
  if (!auth.ok) return auth.response
  const { supabase, usuario } = auth

  // Verificar que a peça pertence ao tenant
  const { data: peca } = await supabase
    .from('pecas')
    .select('id')
    .eq('id', id)
    .eq('tenant_id', usuario.tenant_id)
    .single()

  if (!peca) {
    return jsonError('Peça não encontrada', 404)
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
    return jsonError('Erro ao excluir peça', 500)
  }

  return NextResponse.json({ ok: true })
}
