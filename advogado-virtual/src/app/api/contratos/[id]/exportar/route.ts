import { NextRequest, NextResponse } from 'next/server'
import { getAuthContext } from '@/lib/auth'
import { jsonError } from '@/lib/api'

// POST /api/contratos/[id]/exportar — marca contrato como exportado e retorna conteúdo
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params

  const auth = await getAuthContext()
  if (!auth.ok) return auth.response
  const { supabase, usuario } = auth

  if (!['admin', 'advogado'].includes(usuario.role)) {
    return jsonError('Sem permissão — somente advogados e admins podem exportar contratos', 403)
  }

  const { data: contrato } = await supabase
    .from('contratos_honorarios')
    .select('*, clientes(nome, cpf, endereco, cidade, estado)')
    .eq('id', id)
    .eq('tenant_id', usuario.tenant_id)
    .single()

  if (!contrato) return jsonError('Contrato não encontrado', 404)

  if (!contrato.conteudo_markdown?.trim()) {
    return jsonError('Contrato sem conteúdo para exportar', 400)
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
