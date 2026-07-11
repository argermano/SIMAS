import { NextRequest, NextResponse } from 'next/server'
import { getAuthContext, requireRole } from '@/lib/auth'
import { jsonError } from '@/lib/api'
import { logAudit } from '@/lib/audit'

// POST /api/financeiro/parcelas/[id]/cancelar — cancela parcela EM ABERTO.
// Claim atômico no WHERE status='aberta' (padrão Fase 5).

const ROLES = ['admin', 'advogado', 'colaborador']

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params

  const auth = await getAuthContext()
  if (!auth.ok) return auth.response
  const gate = requireRole(auth.usuario, ROLES)
  if (gate) return gate
  const { supabase, usuario } = auth

  const { data: parcela } = await supabase
    .from('parcelas')
    .select('id, status')
    .eq('id', id)
    .eq('tenant_id', usuario.tenant_id)
    .maybeSingle()
  if (!parcela) return jsonError('Parcela não encontrada', 404)
  if (parcela.status !== 'aberta') {
    return jsonError('Só é possível cancelar parcelas em aberto', 409)
  }

  const { data: canceladas, error } = await supabase
    .from('parcelas')
    .update({ status: 'cancelada' })
    .eq('id', id)
    .eq('tenant_id', usuario.tenant_id)
    .eq('status', 'aberta')
    .select('id, descricao, valor_centavos, vencimento, status')
  if (error) return jsonError(error.message, 500)
  if (!canceladas || canceladas.length === 0) {
    return jsonError('Só é possível cancelar parcelas em aberto', 409)
  }

  await logAudit({
    tenantId: usuario.tenant_id,
    userId: usuario.id,
    action: 'financeiro.cancelar',
    resourceType: 'parcela',
    resourceId: id,
  })

  return NextResponse.json({ parcela: canceladas[0] })
}
