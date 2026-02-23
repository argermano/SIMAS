import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

type TipoTemplate = 'contrato' | 'procuracao' | 'declaracao_hipossuficiencia'
const TIPOS_VALIDOS: TipoTemplate[] = ['contrato', 'procuracao', 'declaracao_hipossuficiencia']

// GET /api/templates/[tipo] — busca template do tenant pelo tipo
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ tipo: string }> }
) {
  const { tipo } = await params

  if (!TIPOS_VALIDOS.includes(tipo as TipoTemplate)) {
    return NextResponse.json({ error: 'Tipo inválido' }, { status: 400 })
  }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })

  const { data: usuario } = await supabase
    .from('users')
    .select('tenant_id')
    .eq('auth_user_id', user.id)
    .single()

  if (!usuario) return NextResponse.json({ error: 'Usuário não encontrado' }, { status: 404 })

  const { data: template } = await supabase
    .from('templates_documentos')
    .select('id, conteudo_markdown, updated_at')
    .eq('tenant_id', usuario.tenant_id)
    .eq('tipo', tipo)
    .single()

  return NextResponse.json({ template: template ?? null })
}

// POST /api/templates/[tipo] — cria ou atualiza template (UPSERT)
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ tipo: string }> }
) {
  const { tipo } = await params

  if (!TIPOS_VALIDOS.includes(tipo as TipoTemplate)) {
    return NextResponse.json({ error: 'Tipo inválido' }, { status: 400 })
  }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })

  const { data: usuario } = await supabase
    .from('users')
    .select('id, tenant_id')
    .eq('auth_user_id', user.id)
    .single()

  if (!usuario) return NextResponse.json({ error: 'Usuário não encontrado' }, { status: 404 })

  const { conteudo_markdown } = await req.json() as { conteudo_markdown: string }

  if (!conteudo_markdown?.trim()) {
    return NextResponse.json({ error: 'Conteúdo obrigatório' }, { status: 400 })
  }

  const { data: template, error } = await supabase
    .from('templates_documentos')
    .upsert(
      {
        tenant_id:         usuario.tenant_id,
        tipo,
        conteudo_markdown: conteudo_markdown.trim(),
        criado_por:        usuario.id,
        updated_at:        new Date().toISOString(),
      },
      { onConflict: 'tenant_id,tipo' }
    )
    .select('id, tipo, updated_at')
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ template }, { status: 201 })
}
