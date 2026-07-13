import { NextRequest, NextResponse } from 'next/server'
import { getAuthContext, requireRole } from '@/lib/auth'
import { jsonError } from '@/lib/api'
import { relayFetch } from '@/lib/conversas/relay'

// GET /api/conversas?status=&inbox=&page= -> relay GET /conversations
export async function GET(req: NextRequest) {
  const auth = await getAuthContext()
  if (!auth.ok) return auth.response
  const gate = requireRole(auth.usuario, ['admin', 'advogado', 'colaborador'])
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

  return NextResponse.json(comLabels(data), { status })
}

/**
 * Garante labels: string[] (default []) em cada conversa, mesmo com o relay
 * antigo (que ainda não devolve o campo). Aditivo e à prova de shape: se o
 * corpo não tiver o formato esperado, repassa intacto.
 */
function comLabels(data: unknown): unknown {
  if (!data || typeof data !== 'object') return data
  const d = data as { conversas?: unknown }
  if (!Array.isArray(d.conversas)) return data
  return {
    ...d,
    conversas: d.conversas.map((c) => {
      if (!c || typeof c !== 'object') return c
      const raw = (c as { labels?: unknown }).labels
      const labels = Array.isArray(raw) ? raw.filter((l): l is string => typeof l === 'string') : []
      return { ...c, labels }
    }),
  }
}
