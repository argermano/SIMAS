import { NextResponse } from 'next/server'
import { getAuthContext } from '@/lib/auth'
import { jsonError } from '@/lib/api'
import { logAudit } from '@/lib/audit'

// POST /api/teses/[id]/rejeitar — descarta uma sugestão de tese. Só admin/advogado.
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const auth = await getAuthContext()
  if (!auth.ok) return auth.response
  const { supabase, usuario } = auth

  if (!(usuario.role === 'admin' || usuario.role === 'advogado')) {
    return jsonError('Sem permissão para rejeitar teses', 403)
  }

  const { motivo } = (await req.json().catch(() => ({}))) as { motivo?: string }

  const { data: tese, error } = await supabase
    .from('teses_escritorio')
    .update({
      status: 'rejeitada',
      rejeitada_por: usuario.id,
      rejeitada_em: new Date().toISOString(),
      motivo_rejeicao: motivo?.trim() || null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)
    .eq('tenant_id', usuario.tenant_id)
    .eq('status', 'sugerida')
    .select('id')
    .single()

  if (error || !tese) return jsonError('Tese não encontrada ou já processada', 404)

  await logAudit({
    tenantId: usuario.tenant_id,
    userId: usuario.id,
    action: 'tese.rejeitar',
    resourceType: 'tese',
    resourceId: id,
    metadata: { motivo: motivo?.trim() || null },
  })

  return NextResponse.json({ ok: true })
}
