import { NextRequest, NextResponse } from 'next/server'
import { getAuthContext } from '@/lib/auth'
import { jsonError, validateBody } from '@/lib/api'
import { z } from 'zod'

const ROLES_REVISORES = ['admin', 'advogado']

const schema = z.object({
  motivo: z.string().min(1, 'Motivo é obrigatório'),
})

// POST /api/pecas/[id]/rejeitar — rejeita peça em fila de revisão
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const auth = await getAuthContext()
  if (!auth.ok) return auth.response
  const { supabase, usuario } = auth

  if (!ROLES_REVISORES.includes(usuario.role)) {
    return jsonError('Sem permissão para rejeitar peças', 403)
  }

  const parsed = await validateBody(req, schema)
  if (!parsed.ok) return parsed.response

  const { data: peca, error } = await supabase
    .from('pecas')
    .update({
      status:           'rejeitada',
      revisado_por:     usuario.id,
      revisado_at:      new Date().toISOString(),
      motivo_rejeicao:  parsed.data.motivo,
    })
    .eq('id', id)
    .eq('tenant_id', usuario.tenant_id)
    .eq('status', 'aguardando_revisao')
    .select('id, status')
    .single()

  if (error || !peca) {
    return jsonError('Peça não encontrada ou não está aguardando revisão', 404)
  }

  return NextResponse.json({ ok: true, peca })
}
