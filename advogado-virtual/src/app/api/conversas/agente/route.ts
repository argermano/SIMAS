import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getAuthContext, requireRole } from '@/lib/auth'
import { jsonError, validateBody } from '@/lib/api'
import { relayFetch } from '@/lib/conversas/relay'

const schemaRegister = z.object({
  token: z.string().min(1),
})

// GET /api/conversas/agente -> relay GET /agents/me
export async function GET() {
  const auth = await getAuthContext()
  if (!auth.ok) return auth.response
  const gate = requireRole(auth.usuario, ['admin', 'advogado'])
  if (gate) return gate

  const email = auth.user.email
  if (!email) return jsonError('E-mail do usuário ausente na sessão', 400)

  const { status, data } = await relayFetch('/agents/me', { method: 'GET', email })
  return NextResponse.json(data, { status })
}

// POST /api/conversas/agente {token} -> relay POST /agents/register
export async function POST(req: NextRequest) {
  const auth = await getAuthContext()
  if (!auth.ok) return auth.response
  const gate = requireRole(auth.usuario, ['admin', 'advogado'])
  if (gate) return gate

  const email = auth.user.email
  if (!email) return jsonError('E-mail do usuário ausente na sessão', 400)

  const parsed = await validateBody(req, schemaRegister)
  if (!parsed.ok) return parsed.response

  const { status, data } = await relayFetch('/agents/register', {
    method: 'POST',
    email,
    body: parsed.data,
  })

  return NextResponse.json(data, { status })
}

// DELETE /api/conversas/agente -> relay DELETE /agents/me
export async function DELETE() {
  const auth = await getAuthContext()
  if (!auth.ok) return auth.response
  const gate = requireRole(auth.usuario, ['admin', 'advogado'])
  if (gate) return gate

  const email = auth.user.email
  if (!email) return jsonError('E-mail do usuário ausente na sessão', 400)

  const { status, data } = await relayFetch('/agents/me', { method: 'DELETE', email })
  return NextResponse.json(data, { status })
}
