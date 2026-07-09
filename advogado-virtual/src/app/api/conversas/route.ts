import { NextRequest, NextResponse } from 'next/server'
import { getAuthContext, requireRole } from '@/lib/auth'
import { jsonError } from '@/lib/api'
import { relayFetch } from '@/lib/conversas/relay'

// GET /api/conversas?status=&inbox=&page= -> relay GET /conversations
export async function GET(req: NextRequest) {
  const auth = await getAuthContext()
  if (!auth.ok) return auth.response
  const gate = requireRole(auth.usuario, ['admin', 'advogado'])
  if (gate) return gate

  const email = auth.user.email
  if (!email) return jsonError('E-mail do usuário ausente na sessão', 400)

  const { searchParams } = new URL(req.url)
  const { status, data } = await relayFetch('/conversations', {
    method: 'GET',
    email,
    query: {
      status: searchParams.get('status') ?? undefined,
      inbox: searchParams.get('inbox') ?? undefined,
      page: searchParams.get('page') ?? undefined,
    },
  })

  return NextResponse.json(data, { status })
}
