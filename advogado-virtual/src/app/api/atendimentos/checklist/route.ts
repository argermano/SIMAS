import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { z } from 'zod'

const schema = z.object({
  atendimentoId:    z.string().uuid(),
  docId:            z.string().min(1),
  entregue:         z.boolean(),
})

// PATCH /api/atendimentos/checklist — marca/desmarca documento como entregue
export async function PATCH(req: NextRequest) {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })

  const { data: usuario } = await supabase
    .from('users')
    .select('id, tenant_id')
    .eq('auth_user_id', user.id)
    .single()
  if (!usuario) return NextResponse.json({ error: 'Usuário não encontrado' }, { status: 404 })

  const body = await req.json()
  const resultado = schema.safeParse(body)
  if (!resultado.success) {
    return NextResponse.json({ error: 'Dados inválidos' }, { status: 400 })
  }

  const { atendimentoId, docId, entregue } = resultado.data

  // Busca atendimento para verificar tenant
  const { data: atendimento } = await supabase
    .from('atendimentos')
    .select('id, checklist_entregues')
    .eq('id', atendimentoId)
    .eq('tenant_id', usuario.tenant_id)
    .single()

  if (!atendimento) return NextResponse.json({ error: 'Atendimento não encontrado' }, { status: 404 })

  const checklist = (atendimento.checklist_entregues ?? {}) as Record<string, boolean>
  checklist[docId] = entregue

  const { error } = await supabase
    .from('atendimentos')
    .update({ checklist_entregues: checklist })
    .eq('id', atendimentoId)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ ok: true, checklist })
}
