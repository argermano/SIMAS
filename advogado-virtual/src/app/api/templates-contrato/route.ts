import { NextRequest, NextResponse } from 'next/server'
import { getAuthContext } from '@/lib/auth'
import { jsonError } from '@/lib/api'

// GET /api/templates-contrato — lista todos os modelos de contrato do tenant
export async function GET() {
  const auth = await getAuthContext()
  if (!auth.ok) return auth.response
  const { supabase, usuario } = auth

  const { data: templates } = await supabase
    .from('templates_contrato')
    .select('id, titulo, created_at, updated_at')
    .eq('tenant_id', usuario.tenant_id)
    .order('updated_at', { ascending: false })

  return NextResponse.json({ templates: templates ?? [] })
}

// POST /api/templates-contrato — salvar novo modelo de contrato (texto já extraído)
export async function POST(req: NextRequest) {
  const auth = await getAuthContext()
  if (!auth.ok) return auth.response
  const { supabase, usuario } = auth

  const { titulo, conteudo_markdown } = await req.json() as {
    titulo?: string
    conteudo_markdown: string
  }

  if (!conteudo_markdown?.trim()) {
    return jsonError('Conteúdo do modelo é obrigatório', 400)
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

  if (error) return jsonError(error.message, 500)

  return NextResponse.json({ template }, { status: 201 })
}
