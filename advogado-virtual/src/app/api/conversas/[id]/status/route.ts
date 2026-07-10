import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getAuthContext, requireRole } from '@/lib/auth'
import { jsonError, validateBody } from '@/lib/api'
import { relayFetch } from '@/lib/conversas/relay'

const schemaStatus = z.object({
  status: z.enum(['open', 'resolved']).optional(),
})

// POST /api/conversas/[id]/status {status?} -> relay POST /conversations/:id/toggle-status
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await getAuthContext()
  if (!auth.ok) return auth.response
  const gate = requireRole(auth.usuario, ['admin', 'advogado', 'colaborador'])
  if (gate) return gate

  const email = auth.user.email
  if (!email) return jsonError('E-mail do usuário ausente na sessão', 400)

  const parsed = await validateBody(req, schemaStatus)
  if (!parsed.ok) return parsed.response

  const { id } = await params
  const { status, data } = await relayFetch(`/conversations/${id}/toggle-status`, {
    method: 'POST',
    email,
    body: parsed.data,
  })

  return NextResponse.json(data, { status })
}
