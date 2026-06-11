import { NextRequest, NextResponse } from 'next/server'
import { getAuthContext } from '@/lib/auth'
import { jsonError } from '@/lib/api'

type TipoTemplate =
  | 'contrato'
  | 'procuracao'
  | 'declaracao_hipossuficiencia'
  | 'contrato_honorarios'
  | 'substabelecimento'
  | 'notificacao_extrajudicial'

const TIPOS_VALIDOS: TipoTemplate[] = [
  'contrato',
  'procuracao',
  'declaracao_hipossuficiencia',
  'contrato_honorarios',
  'substabelecimento',
  'notificacao_extrajudicial',
]

// GET /api/templates/[tipo] — busca template do tenant pelo tipo
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ tipo: string }> }
) {
  const { tipo } = await params

  if (!TIPOS_VALIDOS.includes(tipo as TipoTemplate)) {
    return jsonError('Tipo inválido', 400)
  }

  const auth = await getAuthContext()
  if (!auth.ok) return auth.response
  const { supabase, usuario } = auth

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
    return jsonError('Tipo inválido', 400)
  }

  const auth = await getAuthContext()
  if (!auth.ok) return auth.response
  const { supabase, usuario } = auth

  const { conteudo_markdown } = await req.json() as { conteudo_markdown: string }

  if (!conteudo_markdown?.trim()) {
    return jsonError('Conteúdo obrigatório', 400)
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

  if (error) return jsonError(error.message, 500)

  return NextResponse.json({ template }, { status: 201 })
}

// DELETE /api/templates/[tipo] — remove o template do tenant
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ tipo: string }> }
) {
  const { tipo } = await params

  if (!TIPOS_VALIDOS.includes(tipo as TipoTemplate)) {
    return jsonError('Tipo inválido', 400)
  }

  const auth = await getAuthContext()
  if (!auth.ok) return auth.response
  const { supabase, usuario } = auth

  const { error } = await supabase
    .from('templates_documentos')
    .delete()
    .eq('tenant_id', usuario.tenant_id)
    .eq('tipo', tipo)

  if (error) return jsonError(error.message, 500)

  return NextResponse.json({ ok: true })
}
