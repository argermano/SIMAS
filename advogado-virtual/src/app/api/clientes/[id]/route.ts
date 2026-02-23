import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { z } from 'zod'

const schemaUpdate = z.object({
  nome:         z.string().min(2).max(200).optional(),
  cpf:          z.string().max(20).optional().nullable(),
  rg:           z.string().max(30).optional().nullable(),
  estado_civil: z.string().max(50).optional().nullable(),
  profissao:    z.string().max(100).optional().nullable(),
  telefone:     z.string().max(30).optional().nullable(),
  email:        z.string().email().optional().nullable().or(z.literal('')),
  endereco:     z.string().max(500).optional().nullable(),
  bairro:       z.string().max(100).optional().nullable(),
  cidade:       z.string().max(100).optional().nullable(),
  estado:       z.string().length(2).optional().nullable(),
  cep:          z.string().max(10).optional().nullable(),
  notas:        z.string().max(2000).optional().nullable(),
})

// Helper: verifica se o cliente pertence ao tenant do usuário
async function verificarAcesso(supabase: Awaited<ReturnType<typeof createClient>>, clienteId: string) {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  const { data: usuario } = await supabase
    .from('users')
    .select('id, tenant_id')
    .eq('auth_user_id', user.id)
    .single()

  if (!usuario) return null

  const { data: cliente } = await supabase
    .from('clientes')
    .select('*')
    .eq('id', clienteId)
    .eq('tenant_id', usuario.tenant_id)
    .single()

  return cliente ? { cliente, usuario } : null
}

// ─────────────────────────────────────────────────────────────
// GET /api/clientes/[id]
// ─────────────────────────────────────────────────────────────

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const supabase = await createClient()
  const acesso = await verificarAcesso(supabase, id)

  if (!acesso) return NextResponse.json({ error: 'Não encontrado' }, { status: 404 })

  // Busca com contagem de atendimentos
  const { data: atendimentos } = await supabase
    .from('atendimentos')
    .select('id, status, area, created_at')
    .eq('cliente_id', id)
    .order('created_at', { ascending: false })
    .limit(10)

  return NextResponse.json({
    cliente:      acesso.cliente,
    atendimentos: atendimentos ?? [],
  })
}

// ─────────────────────────────────────────────────────────────
// PATCH /api/clientes/[id]
// ─────────────────────────────────────────────────────────────

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const supabase = await createClient()
  const acesso = await verificarAcesso(supabase, id)

  if (!acesso) return NextResponse.json({ error: 'Não encontrado' }, { status: 404 })

  const body = await req.json()
  const resultado = schemaUpdate.safeParse(body)

  if (!resultado.success) {
    return NextResponse.json(
      { error: 'Dados inválidos', detalhes: resultado.error.flatten() },
      { status: 400 }
    )
  }

  const { data: clienteAtualizado, error } = await supabase
    .from('clientes')
    .update({
      ...resultado.data,
      email: resultado.data.email || null,
    })
    .eq('id', id)
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ cliente: clienteAtualizado })
}

// ─────────────────────────────────────────────────────────────
// DELETE /api/clientes/[id]
// ─────────────────────────────────────────────────────────────

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const supabase = await createClient()
  const acesso = await verificarAcesso(supabase, id)

  if (!acesso) return NextResponse.json({ error: 'Não encontrado' }, { status: 404 })

  const { error } = await supabase
    .from('clientes')
    .delete()
    .eq('id', id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ ok: true })
}
