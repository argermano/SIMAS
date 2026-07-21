import { NextResponse } from 'next/server'
import { z } from 'zod'
import { getAuthContext, requireRole } from '@/lib/auth'
import { jsonError } from '@/lib/api'
import { createClient } from '@/lib/supabase/server'
import { encryptClienteFields, decryptClienteFields } from '@/lib/encryption'
import { logAudit } from '@/lib/audit'

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
  cep:              z.string().max(10).optional().nullable(),
  orgao_expedidor:  z.string().max(50).optional().nullable(),
  nacionalidade:    z.string().max(50).optional().nullable(),
  notas:            z.string().max(2000).optional().nullable(),
})

// Helper: busca o cliente garantindo que pertence ao tenant do usuário
async function buscarCliente(
  supabase: Awaited<ReturnType<typeof createClient>>,
  clienteId: string,
  tenantId: string
) {
  const { data: cliente } = await supabase
    .from('clientes')
    .select('*')
    .eq('id', clienteId)
    .eq('tenant_id', tenantId)
    .is('deleted_at', null)
    .single()

  return cliente
}

// ─────────────────────────────────────────────────────────────
// GET /api/clientes/[id]
// ─────────────────────────────────────────────────────────────

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const auth = await getAuthContext()
  if (!auth.ok) return auth.response
  const { supabase, usuario } = auth

  const cliente = await buscarCliente(supabase, id, usuario.tenant_id)
  if (!cliente) return jsonError('Não encontrado', 404)

  // Busca com contagem de atendimentos
  const { data: atendimentos } = await supabase
    .from('atendimentos')
    .select('id, status, area, created_at')
    .eq('cliente_id', id)
    .order('created_at', { ascending: false })
    .is('deleted_at', null)
    .limit(10)

  return NextResponse.json({
    cliente:      decryptClienteFields(cliente),
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
  const auth = await getAuthContext()
  if (!auth.ok) return auth.response
  const { supabase, usuario } = auth

  const cliente = await buscarCliente(supabase, id, usuario.tenant_id)
  if (!cliente) return jsonError('Não encontrado', 404)

  const body = await req.json()
  const resultado = schemaUpdate.safeParse(body)

  if (!resultado.success) {
    return jsonError('Dados inválidos', 400, resultado.error.flatten())
  }

  const { data: clienteAtualizado, error } = await supabase
    .from('clientes')
    .update({
      ...encryptClienteFields(resultado.data),
      // '' (aceito pelo schema) vira null — mas SÓ quando o e-mail veio no
      // payload. Um PATCH parcial (ex.: só { telefone } do cartão de contato, ou
      // { cidade, estado }) não pode zerar o e-mail de quem não o enviou.
      ...(resultado.data.email !== undefined ? { email: resultado.data.email || null } : {}),
    })
    .eq('id', id)
    .select()
    .single()

  if (error) return jsonError(error.message, 500)

  return NextResponse.json({ cliente: decryptClienteFields(clienteAtualizado) })
}

// ─────────────────────────────────────────────────────────────
// DELETE /api/clientes/[id]
// ─────────────────────────────────────────────────────────────

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const auth = await getAuthContext()
  if (!auth.ok) return auth.response
  const { supabase, usuario } = auth

  // Só admin/advogado pode excluir um cliente (antes: qualquer papel, inclusive colaborador).
  const semPermissao = requireRole(usuario, ['admin', 'advogado'])
  if (semPermissao) return semPermissao

  const cliente = await buscarCliente(supabase, id, usuario.tenant_id)
  if (!cliente) return jsonError('Não encontrado', 404)

  // Soft-delete: preserva o registro (reversível/auditável) e some das listagens.
  const { error } = await supabase
    .from('clientes')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', id)
    .eq('tenant_id', usuario.tenant_id)

  if (error) return jsonError(error.message, 500)

  await logAudit({
    tenantId: usuario.tenant_id,
    userId: usuario.id,
    action: 'cliente.delete',
    resourceType: 'cliente',
    resourceId: id,
    // LGPD: audit só com flags — resourceId já identifica o cliente.
    metadata: { soft: true },
  })

  return NextResponse.json({ ok: true })
}
