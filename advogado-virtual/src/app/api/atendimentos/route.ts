import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { z } from 'zod'

const schemaNovoAtendimento = z.object({
  cliente_id:       z.string().uuid(),
  area:             z.string().min(1),
  tipo_peca_origem: z.string().min(1),
  modo_input:       z.enum(['audio', 'texto']).default('texto'),
})

// POST /api/atendimentos — cria novo atendimento
export async function POST(req: Request) {
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
  const resultado = schemaNovoAtendimento.safeParse(body)

  if (!resultado.success) {
    return NextResponse.json(
      { error: 'Dados inválidos', detalhes: resultado.error.flatten() },
      { status: 400 }
    )
  }

  const dados = resultado.data

  const { data: atendimento, error } = await supabase
    .from('atendimentos')
    .insert({
      tenant_id:        usuario.tenant_id,
      cliente_id:       dados.cliente_id,
      user_id:          usuario.id,
      area:             dados.area,
      tipo_peca_origem: dados.tipo_peca_origem,
      modo_input:       dados.modo_input,
      status:           'caso_novo',
    })
    .select('id')
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ id: atendimento.id }, { status: 201 })
}
