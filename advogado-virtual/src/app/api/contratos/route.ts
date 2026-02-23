import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { z } from 'zod'

const schemaContrato = z.object({
  cliente_id:       z.string().uuid().optional().nullable(),
  atendimento_id:   z.string().uuid().optional().nullable(),
  area:             z.string().optional().nullable(),
  titulo:           z.string().max(300).optional(),
  valor_fixo:       z.number().positive().optional().nullable(),
  percentual_exito: z.number().min(0).max(100).optional().nullable(),
  forma_pagamento:  z.string().max(200).optional().nullable(),
})

// GET /api/contratos — lista contratos do tenant
export async function GET(req: NextRequest) {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })

  const { data: usuario } = await supabase
    .from('users')
    .select('tenant_id')
    .eq('auth_user_id', user.id)
    .single()

  if (!usuario) return NextResponse.json({ error: 'Usuário não encontrado' }, { status: 404 })

  const { searchParams } = new URL(req.url)
  const status = searchParams.get('status')
  const page   = parseInt(searchParams.get('page') ?? '1')
  const limit  = 20
  const offset = (page - 1) * limit

  let query = supabase
    .from('contratos_honorarios')
    .select('*, clientes(nome)', { count: 'exact' })
    .eq('tenant_id', usuario.tenant_id)
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1)

  if (status) query = query.eq('status', status)

  const { data, error, count } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({
    contratos:    data,
    total:        count ?? 0,
    pagina:       page,
    totalPaginas: Math.ceil((count ?? 0) / limit),
  })
}

// POST /api/contratos — criar contrato (rascunho)
export async function POST(req: NextRequest) {
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
  const resultado = schemaContrato.safeParse(body)

  if (!resultado.success) {
    return NextResponse.json(
      { error: 'Dados inválidos', detalhes: resultado.error.flatten() },
      { status: 400 }
    )
  }

  const dados = resultado.data
  const inserir: Record<string, unknown> = {
    tenant_id:  usuario.tenant_id,
    criado_por: usuario.id,
    status:     'rascunho',
  }

  if (dados.cliente_id)       inserir.cliente_id       = dados.cliente_id
  if (dados.atendimento_id)   inserir.atendimento_id   = dados.atendimento_id
  if (dados.area)             inserir.area             = dados.area
  if (dados.titulo)           inserir.titulo           = dados.titulo
  if (dados.valor_fixo)       inserir.valor_fixo       = dados.valor_fixo
  if (dados.percentual_exito !== undefined && dados.percentual_exito !== null) {
    inserir.percentual_exito = dados.percentual_exito
  }
  if (dados.forma_pagamento)  inserir.forma_pagamento  = dados.forma_pagamento

  const { data: contrato, error } = await supabase
    .from('contratos_honorarios')
    .insert(inserir)
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ contrato }, { status: 201 })
}
