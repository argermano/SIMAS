import { NextRequest, NextResponse } from 'next/server'
import { getAuthContext } from '@/lib/auth'
import { jsonError } from '@/lib/api'

// POST /api/contratos/[id]/aprovar — aprova o contrato (admin/advogado apenas)
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params

  const auth = await getAuthContext()
  if (!auth.ok) return auth.response
  const { supabase, usuario } = auth

  if (!['admin', 'advogado'].includes(usuario.role)) {
    return jsonError('Sem permissão — somente advogados e admins podem aprovar contratos', 403)
  }

  const { data: contrato } = await supabase
    .from('contratos_honorarios')
    .select('id, status')
    .eq('id', id)
    .eq('tenant_id', usuario.tenant_id)
    .single()

  if (!contrato) return jsonError('Contrato não encontrado', 404)

  const { data: atualizado, error } = await supabase
    .from('contratos_honorarios')
    .update({ status: 'aprovado' })
    .eq('id', id)
    .select()
    .single()

  if (error) return jsonError(error.message, 500)

  return NextResponse.json({ contrato: atualizado })
}
