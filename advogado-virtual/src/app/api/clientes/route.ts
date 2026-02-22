import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { z } from 'zod'

// ─────────────────────────────────────────────────────────────
// Schema de validação
// ─────────────────────────────────────────────────────────────

const schemaCliente = z.object({
  nome:     z.string().min(2, 'Nome deve ter pelo menos 2 caracteres').max(200),
  cpf:      z.string().max(20).optional().nullable(),
  telefone: z.string().max(30).optional().nullable(),
  email:    z.string().email('E-mail inválido').optional().nullable().or(z.literal('')),
  endereco: z.string().max(500).optional().nullable(),
  notas:    z.string().max(2000).optional().nullable(),
})

// ─────────────────────────────────────────────────────────────
// GET /api/clientes — lista clientes do tenant
// ─────────────────────────────────────────────────────────────

export async function GET(req: Request) {
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
  const busca = searchParams.get('q') ?? ''
  const page  = parseInt(searchParams.get('page') ?? '1')
  const limit = 20
  const offset = (page - 1) * limit

  let query = supabase
    .from('clientes')
    .select('*', { count: 'exact' })
    .eq('tenant_id', usuario.tenant_id)
    .order('nome', { ascending: true })
    .range(offset, offset + limit - 1)

  if (busca) {
    query = query.ilike('nome', `%${busca}%`)
  }

  const { data, error, count } = await query

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({
    clientes:   data,
    total:      count ?? 0,
    pagina:     page,
    totalPaginas: Math.ceil((count ?? 0) / limit),
  })
}

// ─────────────────────────────────────────────────────────────
// POST /api/clientes — cria novo cliente
// ─────────────────────────────────────────────────────────────

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
  const resultado = schemaCliente.safeParse(body)

  if (!resultado.success) {
    return NextResponse.json(
      { error: 'Dados inválidos', detalhes: resultado.error.flatten() },
      { status: 400 }
    )
  }

  const dados = resultado.data

  const { data: cliente, error } = await supabase
    .from('clientes')
    .insert({
      ...dados,
      email:      dados.email || null,
      tenant_id:  usuario.tenant_id,
      created_by: usuario.id,
    })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ cliente }, { status: 201 })
}
