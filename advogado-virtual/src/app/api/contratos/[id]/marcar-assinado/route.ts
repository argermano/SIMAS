import { NextRequest, NextResponse } from 'next/server'
import { getAuthContext } from '@/lib/auth'
import { jsonError } from '@/lib/api'

// POST /api/contratos/[id]/marcar-assinado — confirma assinatura manual (sem arquivo)
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params

  const auth = await getAuthContext()
  if (!auth.ok) return auth.response
  const { supabase, usuario } = auth

  if (!['admin', 'advogado'].includes(usuario.role)) {
    return jsonError('Sem permissão — somente advogados e admins podem confirmar a assinatura', 403)
  }

  const { data: contrato } = await supabase
    .from('contratos_honorarios')
    .select('id')
    .eq('id', id)
    .eq('tenant_id', usuario.tenant_id)
    .single()

  if (!contrato) return jsonError('Contrato não encontrado', 404)

  const { data: atualizado, error } = await supabase
    .from('contratos_honorarios')
    .update({
      status:       'assinado',
      assinado_em:  new Date().toISOString(),
      assinado_por: usuario.id,
    })
    .eq('id', id)
    .eq('tenant_id', usuario.tenant_id)
    .select('id, status, assinado_em')
    .single()

  if (error) return jsonError(error.message, 500)

  return NextResponse.json({ contrato: atualizado })
}
