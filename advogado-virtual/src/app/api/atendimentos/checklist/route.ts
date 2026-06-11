import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getAuthContext } from '@/lib/auth'
import { jsonError, validateBody } from '@/lib/api'

const schema = z.object({
  atendimentoId:    z.string().uuid(),
  docId:            z.string().min(1),
  entregue:         z.boolean(),
})

// PATCH /api/atendimentos/checklist — marca/desmarca documento como entregue
export async function PATCH(req: NextRequest) {
  const auth = await getAuthContext()
  if (!auth.ok) return auth.response
  const { supabase, usuario } = auth

  const parsed = await validateBody(req, schema)
  if (!parsed.ok) return parsed.response

  const { atendimentoId, docId, entregue } = parsed.data

  // Busca atendimento para verificar tenant
  const { data: atendimento } = await supabase
    .from('atendimentos')
    .select('id, checklist_entregues')
    .eq('id', atendimentoId)
    .eq('tenant_id', usuario.tenant_id)
    .single()

  if (!atendimento) return jsonError('Atendimento não encontrado', 404)

  const checklist = (atendimento.checklist_entregues ?? {}) as Record<string, boolean>
  checklist[docId] = entregue

  const { error } = await supabase
    .from('atendimentos')
    .update({ checklist_entregues: checklist })
    .eq('id', atendimentoId)

  if (error) return jsonError(error.message, 500)

  return NextResponse.json({ ok: true, checklist })
}
