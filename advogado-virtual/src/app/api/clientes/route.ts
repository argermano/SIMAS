import { NextResponse } from 'next/server'
import { z } from 'zod'
import { getAuthContext } from '@/lib/auth'
import { jsonError, validateBody } from '@/lib/api'
import { encryptClienteFields, decryptClienteFields } from '@/lib/encryption'

// ─────────────────────────────────────────────────────────────
// Schema de validação
// ─────────────────────────────────────────────────────────────

const schemaCliente = z.object({
  nome:         z.string().min(2, 'Nome deve ter pelo menos 2 caracteres').max(200),
  cpf:          z.string().max(20).optional().nullable(),
  rg:           z.string().max(30).optional().nullable(),
  estado_civil: z.string().max(50).optional().nullable(),
  profissao:    z.string().max(100).optional().nullable(),
  telefone:     z.string().max(30).optional().nullable(),
  email:        z.string().email('E-mail inválido').optional().nullable().or(z.literal('')),
  endereco:     z.string().max(500).optional().nullable(),
  bairro:       z.string().max(100).optional().nullable(),
  cidade:       z.string().max(100).optional().nullable(),
  estado:       z.string().length(2).optional().nullable(),
  cep:              z.string().max(10).optional().nullable(),
  orgao_expedidor:  z.string().max(50).optional().nullable(),
  nacionalidade:    z.string().max(50).optional().nullable(),
  notas:            z.string().max(2000).optional().nullable(),
})

// ─────────────────────────────────────────────────────────────
// GET /api/clientes — lista clientes do tenant
// ─────────────────────────────────────────────────────────────

export async function GET(req: Request) {
  const auth = await getAuthContext()
  if (!auth.ok) return auth.response
  const { supabase, usuario } = auth

  const { searchParams } = new URL(req.url)
  const busca = searchParams.get('q') ?? ''
  const page  = parseInt(searchParams.get('page') ?? '1')
  const limit = 20
  const offset = (page - 1) * limit

  let query = supabase
    .from('clientes')
    .select('*', { count: 'exact' })
    .eq('tenant_id', usuario.tenant_id)
    .is('deleted_at', null)
    .neq('status_cadastro', 'pre_cadastro') // pré-cadastros do funil não aparecem no cadastro/busca
    .order('nome', { ascending: true })
    .range(offset, offset + limit - 1)

  if (busca) {
    query = query.ilike('nome', `%${busca}%`)
  }

  const { data, error, count } = await query

  if (error) return jsonError(error.message, 500)

  return NextResponse.json({
    clientes:   (data ?? []).map(decryptClienteFields),
    total:      count ?? 0,
    pagina:     page,
    totalPaginas: Math.ceil((count ?? 0) / limit),
  })
}

// ─────────────────────────────────────────────────────────────
// POST /api/clientes — cria novo cliente
// ─────────────────────────────────────────────────────────────

export async function POST(req: Request) {
  const auth = await getAuthContext()
  if (!auth.ok) return auth.response
  const { supabase, usuario } = auth

  const parsed = await validateBody(req, schemaCliente)
  if (!parsed.ok) return parsed.response

  const dados = parsed.data

  const { data: cliente, error } = await supabase
    .from('clientes')
    .insert({
      ...encryptClienteFields(dados),
      email:      dados.email || null,
      tenant_id:  usuario.tenant_id,
      created_by: usuario.id,
    })
    .select()
    .single()

  if (error) return jsonError(error.message, 500)

  return NextResponse.json({ cliente: decryptClienteFields(cliente) }, { status: 201 })
}
