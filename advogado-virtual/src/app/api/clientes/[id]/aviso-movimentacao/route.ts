import { NextResponse } from 'next/server'
import { z } from 'zod'
import { getAuthContext, requireRole } from '@/lib/auth'
import { jsonError, validateBody } from '@/lib/api'
import { logAudit } from '@/lib/audit'

const schema = z.object({
  aviso_movimentacao: z.enum(['desligado', 'fila', 'automatico']),
})

// PATCH /api/clientes/[id]/aviso-movimentacao — define o modo de aviso de
// movimentação do cliente (desligado/fila/automatico). Rota isolada para não
// mexer nos demais campos do cadastro. admin/advogado.
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await getAuthContext()
  if (!auth.ok) return auth.response
  const { supabase, usuario } = auth
  const gate = requireRole(usuario, ['admin', 'advogado'])
  if (gate) return gate
  const { id } = await params

  const parsed = await validateBody(req, schema)
  if (!parsed.ok) return parsed.response

  const { error } = await supabase
    .from('clientes')
    .update({ aviso_movimentacao: parsed.data.aviso_movimentacao })
    .eq('id', id)
    .eq('tenant_id', usuario.tenant_id)

  if (error) return jsonError(error.message, 500)

  await logAudit({
    tenantId: usuario.tenant_id,
    userId: usuario.id,
    action: 'cliente.aviso_movimentacao',
    resourceType: 'cliente',
    resourceId: id,
    metadata: { modo: parsed.data.aviso_movimentacao },
  })

  return NextResponse.json({ ok: true, aviso_movimentacao: parsed.data.aviso_movimentacao })
}
