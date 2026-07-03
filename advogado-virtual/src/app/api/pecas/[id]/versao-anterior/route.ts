import { NextResponse } from 'next/server'
import { getAuthContext } from '@/lib/auth'
import { jsonError } from '@/lib/api'

// GET /api/pecas/[id]/versao-anterior — conteúdo da última versão histórica da
// peça (para o comparador de seções E9). Escopo por tenant (via RLS + join).
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params

  const auth = await getAuthContext()
  if (!auth.ok) return auth.response
  const { supabase, usuario } = auth

  // Confirma que a peça é do tenant.
  const { data: peca } = await supabase
    .from('pecas')
    .select('id')
    .eq('id', id)
    .eq('tenant_id', usuario.tenant_id)
    .single()
  if (!peca) return jsonError('Peça não encontrada', 404)

  const { data: versao } = await supabase
    .from('pecas_versoes')
    .select('versao, conteudo_markdown, created_at')
    .eq('peca_id', id)
    .order('versao', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (!versao?.conteudo_markdown) {
    return NextResponse.json({ temVersao: false })
  }

  return NextResponse.json({
    temVersao: true,
    versao: versao.versao,
    conteudo: versao.conteudo_markdown,
  })
}
