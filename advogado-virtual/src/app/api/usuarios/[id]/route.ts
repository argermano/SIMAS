import { NextRequest, NextResponse } from 'next/server'
import { getAuthContext } from '@/lib/auth'
import { jsonError } from '@/lib/api'
import { logAudit } from '@/lib/audit'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { apenasDigitos } from '@/lib/funil/telefone'
import { z } from 'zod'

const schema = z.object({
  role:                  z.enum(['admin', 'advogado', 'colaborador']).optional(),
  status:                z.enum(['ativo', 'inativo']).optional(),
  is_advogado_principal: z.boolean().optional(),
  // Unidade do membro; roteia o número de saída do WhatsApp. '' → null (sem preferência).
  unidade:               z.enum(['brasilia', 'florianopolis', 'blumenau']).nullable().optional(),
  // Celular (WhatsApp) do PRÓPRIO membro. Aceita mascarado; guarda SÓ dígitos.
  // '' (limpar) → null. Valida BR: DDD + número (10/11), com DDI opcional (12/13).
  celular:               z
                           .string()
                           .trim()
                           .transform(s => apenasDigitos(s))
                           .refine(d => d === '' || (d.length >= 10 && d.length <= 13), {
                             message: 'Celular inválido (informe DDD + número)',
                           })
                           .transform(d => (d === '' ? null : d))
                           .nullable()
                           .optional(),
}).refine(
  data =>
    data.role ||
    data.status ||
    data.is_advogado_principal !== undefined ||
    data.unidade !== undefined ||
    data.celular !== undefined,
  { message: 'Informe role, status, is_advogado_principal, unidade ou celular' },
)

function getAdminSupabase() {
  return createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )
}

// PATCH /api/usuarios/[id] — atualiza role ou status (admin only)
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params

  const auth = await getAuthContext()
  if (!auth.ok) return auth.response
  const { usuario: admin } = auth

  if (admin.role !== 'admin') return jsonError('Apenas administradores podem alterar perfis', 403)

  const body = await req.json()
  const resultado = schema.safeParse(body)
  if (!resultado.success) {
    return jsonError('Dados inválidos', 400, resultado.error.flatten())
  }

  // Admin não pode alterar o próprio role/status, mas pode definir-se como advogado
  // principal e ajustar a própria unidade (número de saída do WhatsApp).
  if (id === admin.id && (resultado.data.role || resultado.data.status)) {
    return jsonError('Você não pode alterar seu próprio perfil', 400)
  }

  // Usa admin client para bypass de RLS (já verificamos permissões acima)
  const adminDb = getAdminSupabase()

  // Se estiver definindo como advogado principal, limpar a flag nos demais primeiro
  if (resultado.data.is_advogado_principal === true) {
    await adminDb
      .from('users')
      .update({ is_advogado_principal: false })
      .eq('tenant_id', admin.tenant_id)
      .neq('id', id)
  }

  const { data: usuario, error } = await adminDb
    .from('users')
    .update(resultado.data)
    .eq('id', id)
    .eq('tenant_id', admin.tenant_id)
    .select('id, nome, email, role, status, is_advogado_principal, unidade, celular')
    .single()

  if (error || !usuario) {
    return jsonError('Usuário não encontrado', 404)
  }

  // LGPD: nunca gravar o número no audit — só sinaliza que o celular mudou.
  const { celular, ...metadata } = resultado.data
  await logAudit({
    tenantId:     admin.tenant_id,
    userId:       admin.id,
    action:       'user.update',
    resourceType: 'user',
    resourceId:   id,
    metadata:     celular !== undefined
                    ? { ...metadata, celular: celular === null ? 'removido' : 'atualizado' }
                    : metadata,
  })

  return NextResponse.json({ ok: true, usuario })
}

// DELETE /api/usuarios/[id] — remove usuário do escritório (admin only)
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params

  const auth = await getAuthContext()
  if (!auth.ok) return auth.response
  const { usuario: admin } = auth

  if (admin.role !== 'admin') return jsonError('Apenas administradores podem remover usuários', 403)
  if (id === admin.id) return jsonError('Você não pode remover a si mesmo', 400)

  const adminDb = getAdminSupabase()

  const { error } = await adminDb
    .from('users')
    .update({ status: 'inativo' })
    .eq('id', id)
    .eq('tenant_id', admin.tenant_id)

  if (error) return jsonError('Erro ao remover usuário', 500)

  await logAudit({
    tenantId:     admin.tenant_id,
    userId:       admin.id,
    action:       'user.delete',
    resourceType: 'user',
    resourceId:   id,
  })

  return NextResponse.json({ ok: true })
}
