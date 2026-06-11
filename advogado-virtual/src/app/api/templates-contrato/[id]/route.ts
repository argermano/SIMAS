import { NextRequest, NextResponse } from 'next/server'
import { getAuthContext } from '@/lib/auth'
import { jsonError } from '@/lib/api'

// GET /api/templates-contrato/[id] — busca modelo com conteúdo completo
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const auth = await getAuthContext()
  if (!auth.ok) return auth.response
  const { supabase, usuario } = auth

  const { data: template } = await supabase
    .from('templates_contrato')
    .select('id, titulo, conteudo_markdown, created_at, updated_at')
    .eq('id', id)
    .eq('tenant_id', usuario.tenant_id)
    .single()

  if (!template) return jsonError('Template não encontrado', 404)

  return NextResponse.json({ template })
}

// DELETE /api/templates-contrato/[id] — remove modelo
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const auth = await getAuthContext()
  if (!auth.ok) return auth.response
  const { supabase, usuario } = auth

  const { error } = await supabase
    .from('templates_contrato')
    .delete()
    .eq('id', id)
    .eq('tenant_id', usuario.tenant_id)

  if (error) return jsonError(error.message, 500)

  return NextResponse.json({ ok: true })
}
