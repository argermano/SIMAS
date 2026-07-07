import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { getAuthContext, requireRole } from '@/lib/auth'
import { jsonError, validateBody } from '@/lib/api'
import { simularMovimento } from '@/lib/processos/sync'

export const maxDuration = 30

const schema = z.object({
  nome: z.string().max(200).optional(),
  categoria: z.string().max(40).optional(),
  resumo: z.string().max(600).optional(),
})

// POST /api/processos/[id]/simular-movimento — insere um movimento fictício e roda
// o fluxo de aviso (teste on-demand do dono). admin/advogado apenas.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await getAuthContext()
  if (!auth.ok) return auth.response
  const { supabase, usuario } = auth
  const gate = requireRole(usuario, ['admin', 'advogado'])
  if (gate) return gate
  const { id } = await params

  // Garante que o processo é do tenant do usuário antes de tocar via admin
  const { data: proc } = await supabase.from('processos').select('id').eq('id', id).eq('tenant_id', usuario.tenant_id).single()
  if (!proc) return jsonError('Processo não encontrado.', 404)

  const parsed = await validateBody(req, schema)
  if (!parsed.ok) return parsed.response

  const admin = createAdminClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
  const r = await simularMovimento(admin, id, parsed.data)
  return NextResponse.json(r)
}
