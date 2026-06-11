import { NextRequest, NextResponse } from 'next/server'
import { getAuthContext, requireRole } from '@/lib/auth'
import { jsonError } from '@/lib/api'

// GET /api/modelos-documento/[id] — busca um modelo com conteúdo
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const auth = await getAuthContext()
  if (!auth.ok) return auth.response
  const { supabase, usuario } = auth

  const { data: modelo } = await supabase
    .from('modelos_documento')
    .select('*')
    .eq('id', id)
    .eq('tenant_id', usuario.tenant_id)
    .single()

  if (!modelo) return jsonError('Modelo não encontrado', 404)

  return NextResponse.json({ modelo })
}

// PATCH /api/modelos-documento/[id] — atualizar modelo
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const auth = await getAuthContext()
  if (!auth.ok) return auth.response
  const { supabase, usuario } = auth

  const roleError = requireRole(usuario, ['admin', 'advogado'])
  if (roleError) return roleError

  const body = await req.json() as {
    titulo?: string
    descricao?: string
    conteudo_markdown?: string
  }

  const updates: Record<string, unknown> = {}
  if (body.titulo !== undefined) updates.titulo = body.titulo.trim()
  if (body.descricao !== undefined) updates.descricao = body.descricao?.trim() || null
  if (body.conteudo_markdown !== undefined) updates.conteudo_markdown = body.conteudo_markdown

  const { data: modelo, error } = await supabase
    .from('modelos_documento')
    .update(updates)
    .eq('id', id)
    .eq('tenant_id', usuario.tenant_id)
    .select('id, tipo, titulo, descricao, updated_at')
    .single()

  if (error) return jsonError(error.message, 500)
  if (!modelo) return jsonError('Modelo não encontrado', 404)

  return NextResponse.json({ modelo })
}

// DELETE /api/modelos-documento/[id] — excluir modelo
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const auth = await getAuthContext()
  if (!auth.ok) return auth.response
  const { supabase, usuario } = auth

  const roleError = requireRole(usuario, ['admin', 'advogado'])
  if (roleError) return roleError

  // Buscar file_url para limpar storage
  const { data: modelo } = await supabase
    .from('modelos_documento')
    .select('file_url')
    .eq('id', id)
    .eq('tenant_id', usuario.tenant_id)
    .single()

  if (!modelo) return jsonError('Modelo não encontrado', 404)

  if (modelo.file_url) {
    await supabase.storage.from('documentos').remove([modelo.file_url])
  }

  const { error } = await supabase
    .from('modelos_documento')
    .delete()
    .eq('id', id)
    .eq('tenant_id', usuario.tenant_id)

  if (error) return jsonError(error.message, 500)

  return NextResponse.json({ ok: true })
}
