import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
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
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })

  const { data: usuario } = await supabase
    .from('users')
    .select('id, tenant_id, role')
    .eq('auth_user_id', user.id)
    .single()

  if (!usuario) return NextResponse.json({ error: 'Usuário não encontrado' }, { status: 404 })

  if (!ROLES_REVISORES.includes(usuario.role)) {
    return NextResponse.json({ error: 'Sem permissão para rejeitar peças' }, { status: 403 })
  }

  const body = await req.json()
  const resultado = schema.safeParse(body)
  if (!resultado.success) {
    return NextResponse.json(
      { error: 'Dados inválidos', detalhes: resultado.error.flatten() },
      { status: 400 }
    )
  }

  const { data: peca, error } = await supabase
    .from('pecas')
    .update({
      status:           'rejeitada',
      revisado_por:     usuario.id,
      revisado_at:      new Date().toISOString(),
      motivo_rejeicao:  resultado.data.motivo,
    })
    .eq('id', id)
    .eq('tenant_id', usuario.tenant_id)
    .eq('status', 'aguardando_revisao')
    .select('id, status')
    .single()

  if (error || !peca) {
    return NextResponse.json(
      { error: 'Peça não encontrada ou não está aguardando revisão' },
      { status: 404 }
    )
  }

  return NextResponse.json({ ok: true, peca })
}
