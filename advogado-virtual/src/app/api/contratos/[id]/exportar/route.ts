import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

// POST /api/contratos/[id]/exportar — marca contrato como exportado e retorna conteúdo
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })

  const { data: usuario } = await supabase
    .from('users')
    .select('id, tenant_id, role')
    .eq('auth_user_id', user.id)
    .single()

  if (!usuario) return NextResponse.json({ error: 'Usuário não encontrado' }, { status: 404 })

  if (!['admin', 'advogado'].includes(usuario.role)) {
    return NextResponse.json({ error: 'Sem permissão — somente advogados e admins podem exportar contratos' }, { status: 403 })
  }

  const { data: contrato } = await supabase
    .from('contratos_honorarios')
    .select('*, clientes(nome, cpf, endereco, cidade, estado)')
    .eq('id', id)
    .eq('tenant_id', usuario.tenant_id)
    .single()

  if (!contrato) return NextResponse.json({ error: 'Contrato não encontrado' }, { status: 404 })

  if (!contrato.conteudo_markdown?.trim()) {
    return NextResponse.json({ error: 'Contrato sem conteúdo para exportar' }, { status: 400 })
  }

  // Marcar como exportado
  await supabase
    .from('contratos_honorarios')
    .update({ status: 'exportado' })
    .eq('id', id)

  // Retorna markdown para o frontend fazer download
  return NextResponse.json({
    ok:               true,
    titulo:           contrato.titulo,
    conteudo_markdown: contrato.conteudo_markdown,
  })
}
