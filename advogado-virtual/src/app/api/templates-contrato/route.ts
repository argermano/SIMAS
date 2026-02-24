import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

// GET /api/templates-contrato — lista todos os modelos de contrato do tenant
export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })

  const { data: usuario } = await supabase
    .from('users')
    .select('tenant_id')
    .eq('auth_user_id', user.id)
    .single()
  if (!usuario) return NextResponse.json({ error: 'Usuário não encontrado' }, { status: 404 })

  const { data: templates } = await supabase
    .from('templates_contrato')
    .select('id, titulo, created_at, updated_at')
    .eq('tenant_id', usuario.tenant_id)
    .order('updated_at', { ascending: false })

  return NextResponse.json({ templates: templates ?? [] })
}

// POST /api/templates-contrato — salvar novo modelo de contrato (texto já extraído)
export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })

  const { data: usuario } = await supabase
    .from('users')
    .select('id, tenant_id')
    .eq('auth_user_id', user.id)
    .single()
  if (!usuario) return NextResponse.json({ error: 'Usuário não encontrado' }, { status: 404 })

  const { titulo, conteudo_markdown } = await req.json() as {
    titulo?: string
    conteudo_markdown: string
  }

  if (!conteudo_markdown?.trim()) {
    return NextResponse.json({ error: 'Conteúdo do modelo é obrigatório' }, { status: 400 })
  }

  const { data: template, error } = await supabase
    .from('templates_contrato')
    .insert({
      tenant_id: usuario.tenant_id,
      titulo: titulo || 'Contrato de Honorários',
      conteudo_markdown: conteudo_markdown.trim(),
      created_by: usuario.id,
    })
    .select('id, titulo, created_at')
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ template }, { status: 201 })
}
