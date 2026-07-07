import { NextResponse } from 'next/server'
import { z } from 'zod'
import { getAuthContext, requireRole } from '@/lib/auth'
import { jsonError, validateBody } from '@/lib/api'
import { logAudit } from '@/lib/audit'
import { VIP_MAX } from '@/lib/processos/categorias'

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
  const novo = parsed.data.aviso_movimentacao

  // Teto de VIPs: ao tornar um cliente monitorado (fila/automático), garante que
  // o total de VIPs do tenant não ultrapasse VIP_MAX. Conta os OUTROS VIPs (exclui
  // este cliente) — trocar fila↔automático de um VIP já existente é sempre permitido.
  if (novo !== 'desligado') {
    const { count } = await supabase
      .from('clientes')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', usuario.tenant_id)
      .is('deleted_at', null)
      .neq('aviso_movimentacao', 'desligado')
      .neq('id', id)
    if ((count ?? 0) >= VIP_MAX) {
      return jsonError(
        `Limite de ${VIP_MAX} clientes com aviso automático atingido. Desligue o aviso de outro cliente antes de ativar mais um.`,
        409,
      )
    }
  }

  const { error } = await supabase
    .from('clientes')
    .update({ aviso_movimentacao: novo })
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
