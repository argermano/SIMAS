import { NextResponse } from 'next/server'
import { z } from 'zod'
import { getAuthContext, requireRole } from '@/lib/auth'
import { jsonError } from '@/lib/api'
import { logAudit } from '@/lib/audit'

// GET /api/atendimentos/[id] — retorna atendimento com documentos
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params

  const auth = await getAuthContext()
  if (!auth.ok) return auth.response
  const { supabase, usuario } = auth

  const { data: atendimento, error } = await supabase
    .from('atendimentos')
    .select('*, clientes(id, nome), documentos(*), analises(id, plano_a, resumo_fatos, status, created_at), pecas(id, tipo, area, versao, status, created_at)')
    .eq('id', id)
    .eq('tenant_id', usuario.tenant_id)
    .is('deleted_at', null)
    .single()

  if (error || !atendimento) {
    return jsonError('Atendimento não encontrado', 404)
  }

  // Fetch contratos linked to this atendimento
  const { data: contratos } = await supabase
    .from('contratos_honorarios')
    .select('id, titulo, status, area, created_at')
    .eq('atendimento_id', id)
    .order('created_at', { ascending: false })

  return NextResponse.json({ atendimento, contratos: contratos ?? [] })
}

const schemaUpdate = z.object({
  transcricao_editada:          z.string().optional(),
  pedidos_especificos:          z.string().optional(),
  status:                       z.enum(['caso_novo', 'peca_gerada', 'finalizado']).optional(),
  modo_input:                   z.enum(['audio', 'texto']).optional(),
  tipo_servico:                 z.enum(['administrativo', 'judicial']).nullable().optional(),
  tipo_processo:                z.string().nullable().optional(),
  consentimento_gravacao:       z.boolean().optional(),
  consentimento_confirmado_em:  z.string().optional(), // ISO 8601
}).partial()

// PATCH /api/atendimentos/[id] — atualiza atendimento
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params

  const auth = await getAuthContext()
  if (!auth.ok) return auth.response
  const { supabase, usuario } = auth

  const body = await req.json()
  const resultado = schemaUpdate.safeParse(body)

  if (!resultado.success) {
    return jsonError('Dados inválidos', 400, resultado.error.flatten())
  }

  const { data: atendimento, error } = await supabase
    .from('atendimentos')
    .update(resultado.data)
    .eq('id', id)
    .eq('tenant_id', usuario.tenant_id)
    .select('id, status')
    .single()

  if (error || !atendimento) {
    return jsonError('Atendimento não encontrado', 404)
  }

  return NextResponse.json({ atendimento })
}

// DELETE /api/atendimentos/[id] — soft-delete do caso (preserva peças, análises,
// documentos e áudio; some das listagens e pode ser revertido/auditado).
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params

  const auth = await getAuthContext()
  if (!auth.ok) return auth.response
  const { supabase, usuario } = auth

  // Só admin/advogado pode excluir um caso (antes: qualquer papel, com cascata
  // hard-delete irreversível de peças/análises/documentos + remoção do Storage).
  const semPermissao = requireRole(usuario, ['admin', 'advogado'])
  if (semPermissao) return semPermissao

  // Verificar que o atendimento pertence ao tenant e ainda está ativo
  const { data: at } = await supabase
    .from('atendimentos')
    .select('id')
    .eq('id', id)
    .eq('tenant_id', usuario.tenant_id)
    .is('deleted_at', null)
    .single()

  if (!at) {
    return jsonError('Atendimento não encontrado', 404)
  }

  const { error: delError } = await supabase
    .from('atendimentos')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', id)
    .eq('tenant_id', usuario.tenant_id)

  if (delError) {
    return jsonError('Erro ao excluir atendimento', 500)
  }

  await logAudit({
    tenantId: usuario.tenant_id,
    userId: usuario.id,
    action: 'atendimento.delete',
    resourceType: 'atendimento',
    resourceId: id,
    metadata: { soft: true },
  })

  return NextResponse.json({ ok: true })
}
