import { NextResponse } from 'next/server'
import { getAuthContext, requireRole } from '@/lib/auth'
import { jsonError } from '@/lib/api'
import { relayFetch } from '@/lib/conversas/relay'

// GET /api/conversas/agentes -> relay GET /agents
export async function GET() {
  const auth = await getAuthContext()
  if (!auth.ok) return auth.response
  const gate = requireRole(auth.usuario, ['admin', 'advogado', 'colaborador'])
  if (gate) return gate

  const email = auth.user.email
  if (!email) return jsonError('E-mail do usuário ausente na sessão', 400)

  const { status, data } = await relayFetch('/agents', { method: 'GET', email })
  return NextResponse.json(data, { status })
}
