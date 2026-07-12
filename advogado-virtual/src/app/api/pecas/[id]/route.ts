import { NextResponse } from 'next/server'
import { getAuthContext } from '@/lib/auth'
import { jsonError } from '@/lib/api'

// GET /api/pecas/[id] — conteúdo atual da peça. Usado pela recuperação
// pós-queda (polling do texto que a rede de segurança salva no servidor).
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params

  const auth = await getAuthContext()
  if (!auth.ok) return auth.response
  const { supabase, usuario } = auth

  const { data: peca } = await supabase
    .from('pecas')
    .select('id, conteudo_markdown, versao, status')
    .eq('id', id)
    .eq('tenant_id', usuario.tenant_id)
    .single()

  if (!peca) {
    return jsonError('Peça não encontrada', 404)
  }

  return NextResponse.json({ peca })
}

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
