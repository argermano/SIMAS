import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { z } from 'zod'

// GET /api/atendimentos/[id] — retorna atendimento com documentos
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })

  const { data: usuario } = await supabase
    .from('users')
    .select('tenant_id')
    .eq('auth_user_id', user.id)
    .single()

  if (!usuario) return NextResponse.json({ error: 'Usuário não encontrado' }, { status: 404 })

  const { data: atendimento, error } = await supabase
    .from('atendimentos')
    .select('*, clientes(id, nome), documentos(*)')
    .eq('id', id)
    .eq('tenant_id', usuario.tenant_id)
    .single()

  if (error || !atendimento) {
    return NextResponse.json({ error: 'Atendimento não encontrado' }, { status: 404 })
  }

  return NextResponse.json({ atendimento })
}

const schemaUpdate = z.object({
  transcricao_editada:  z.string().optional(),
  pedidos_especificos:  z.string().optional(),
  status:               z.enum(['caso_novo', 'peca_gerada', 'finalizado']).optional(),
  modo_input:           z.enum(['audio', 'texto']).optional(),
}).partial()

// PATCH /api/atendimentos/[id] — atualiza atendimento
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })

  const { data: usuario } = await supabase
    .from('users')
    .select('tenant_id')
    .eq('auth_user_id', user.id)
    .single()

  if (!usuario) return NextResponse.json({ error: 'Usuário não encontrado' }, { status: 404 })

  const body = await req.json()
  const resultado = schemaUpdate.safeParse(body)

  if (!resultado.success) {
    return NextResponse.json(
      { error: 'Dados inválidos', detalhes: resultado.error.flatten() },
      { status: 400 }
    )
  }

  const { data: atendimento, error } = await supabase
    .from('atendimentos')
    .update(resultado.data)
    .eq('id', id)
    .eq('tenant_id', usuario.tenant_id)
    .select('id, status')
    .single()

  if (error || !atendimento) {
    return NextResponse.json({ error: 'Atendimento não encontrado' }, { status: 404 })
  }

  return NextResponse.json({ atendimento })
}

// DELETE /api/atendimentos/[id] — exclui atendimento e dados relacionados
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })

  const { data: usuario } = await supabase
    .from('users')
    .select('tenant_id')
    .eq('auth_user_id', user.id)
    .single()

  if (!usuario) return NextResponse.json({ error: 'Usuário não encontrado' }, { status: 404 })

  // Verificar que o atendimento pertence ao tenant
  const { data: at } = await supabase
    .from('atendimentos')
    .select('id')
    .eq('id', id)
    .eq('tenant_id', usuario.tenant_id)
    .single()

  if (!at) {
    return NextResponse.json({ error: 'Atendimento não encontrado' }, { status: 404 })
  }

  // Excluir dados relacionados em cascata
  const { data: pecasIds } = await supabase
    .from('pecas')
    .select('id')
    .eq('atendimento_id', id)

  if (pecasIds && pecasIds.length > 0) {
    const ids = pecasIds.map(p => p.id)
    await supabase.from('pecas_versoes').delete().in('peca_id', ids)
    await supabase.from('pecas').delete().in('id', ids)
  }

  await supabase.from('analises').delete().eq('atendimento_id', id)
  await supabase.from('documentos').delete().eq('atendimento_id', id)

  const { error: delError } = await supabase
    .from('atendimentos')
    .delete()
    .eq('id', id)
    .eq('tenant_id', usuario.tenant_id)

  if (delError) {
    return NextResponse.json({ error: 'Erro ao excluir atendimento' }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}
