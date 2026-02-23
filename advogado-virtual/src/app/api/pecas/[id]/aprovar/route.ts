import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

const ROLES_REVISORES = ['admin', 'advogado']

// POST /api/pecas/[id]/aprovar — aprova peça em fila de revisão
export async function POST(
  _req: NextRequest,
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
    return NextResponse.json({ error: 'Sem permissão para aprovar peças' }, { status: 403 })
  }

  const { data: peca, error } = await supabase
    .from('pecas')
    .update({
      status:       'rascunho',
      revisado_por: usuario.id,
      revisado_at:  new Date().toISOString(),
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
