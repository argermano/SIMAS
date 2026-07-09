import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getAuthContext, requireRole } from '@/lib/auth'
import { jsonError, validateBody } from '@/lib/api'
import { relayFetch } from '@/lib/conversas/relay'

const schemaAtribuir = z
  .object({
    self: z.boolean().optional(),
    agentId: z.number().int().optional(),
  })
  .refine((v) => v.self === true || typeof v.agentId === 'number', {
    message: 'Informe self:true ou agentId',
  })

// POST /api/conversas/[id]/atribuir {self} | {agentId} -> relay POST /conversations/:id/assign
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await getAuthContext()
  if (!auth.ok) return auth.response
  const gate = requireRole(auth.usuario, ['admin', 'advogado'])
  if (gate) return gate

  const email = auth.user.email
  if (!email) return jsonError('E-mail do usuário ausente na sessão', 400)

  const parsed = await validateBody(req, schemaAtribuir)
  if (!parsed.ok) return parsed.response

  const { id } = await params
  const { status, data } = await relayFetch(`/conversations/${id}/assign`, {
    method: 'POST',
    email,
    body: parsed.data,
  })

  return NextResponse.json(data, { status })
}
