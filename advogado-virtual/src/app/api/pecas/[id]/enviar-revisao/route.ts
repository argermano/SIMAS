import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

// POST /api/pecas/[id]/enviar-revisao — envia peça para fila de revisão
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
    .select('id, tenant_id')
    .eq('auth_user_id', user.id)
    .single()

  if (!usuario) return NextResponse.json({ error: 'Usuário não encontrado' }, { status: 404 })

  const { data: peca, error } = await supabase
    .from('pecas')
    .update({ status: 'aguardando_revisao' })
    .eq('id', id)
    .eq('tenant_id', usuario.tenant_id)
    .eq('status', 'rascunho')
    .select('id, status')
    .single()

  if (error || !peca) {
    return NextResponse.json(
      { error: 'Peça não encontrada ou não está em rascunho' },
      { status: 404 }
    )
  }

  return NextResponse.json({ ok: true, peca })
}
