import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

// GET /api/modelos-documento/[id] — busca um modelo com conteúdo
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
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

  const { data: modelo } = await supabase
    .from('modelos_documento')
    .select('*')
    .eq('id', id)
    .eq('tenant_id', usuario.tenant_id)
    .single()

  if (!modelo) return NextResponse.json({ error: 'Modelo não encontrado' }, { status: 404 })

  return NextResponse.json({ modelo })
}

// PATCH /api/modelos-documento/[id] — atualizar modelo
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })

  const { data: usuario } = await supabase
    .from('users')
    .select('tenant_id, role')
    .eq('auth_user_id', user.id)
    .single()
  if (!usuario) return NextResponse.json({ error: 'Usuário não encontrado' }, { status: 404 })

  if (usuario.role !== 'admin' && usuario.role !== 'advogado') {
    return NextResponse.json({ error: 'Sem permissão' }, { status: 403 })
  }

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

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!modelo) return NextResponse.json({ error: 'Modelo não encontrado' }, { status: 404 })

  return NextResponse.json({ modelo })
}

// DELETE /api/modelos-documento/[id] — excluir modelo
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })

  const { data: usuario } = await supabase
    .from('users')
    .select('tenant_id, role')
    .eq('auth_user_id', user.id)
    .single()
  if (!usuario) return NextResponse.json({ error: 'Usuário não encontrado' }, { status: 404 })

  if (usuario.role !== 'admin' && usuario.role !== 'advogado') {
    return NextResponse.json({ error: 'Sem permissão' }, { status: 403 })
  }

  // Buscar file_url para limpar storage
  const { data: modelo } = await supabase
    .from('modelos_documento')
    .select('file_url')
    .eq('id', id)
    .eq('tenant_id', usuario.tenant_id)
    .single()

  if (!modelo) return NextResponse.json({ error: 'Modelo não encontrado' }, { status: 404 })

  if (modelo.file_url) {
    await supabase.storage.from('documentos').remove([modelo.file_url])
  }

  const { error } = await supabase
    .from('modelos_documento')
    .delete()
    .eq('id', id)
    .eq('tenant_id', usuario.tenant_id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ ok: true })
}
