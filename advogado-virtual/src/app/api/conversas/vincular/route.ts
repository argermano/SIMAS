import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getAuthContext, requireRole } from '@/lib/auth'
import { jsonError, validateBody } from '@/lib/api'
import { logAudit } from '@/lib/audit'
import { apenasDigitos, mesmoTelefone } from '@/lib/conversas/telefone'

// POST /api/conversas/vincular {clienteId, telefone, substituir?} — vincula o
// telefone da conversa a um cliente do SIMAS (grava clientes.telefone, padrão
// do cadastro). Se o cliente já tem OUTRO telefone e substituir não veio,
// devolve 409 {code:"TELEFONE_DIFERENTE", telefoneAtual} para o front confirmar.
// Se OUTRO cliente do tenant já tem o mesmo número, devolve 409
// {code:"TELEFONE_EM_USO", clienteNome} — vincular por cima deixaria o contexto
// casando com o cliente antigo (match por created_at asc).

const schemaVincular = z.object({
  clienteId: z.string().uuid(),
  telefone: z.string().min(1).max(30),
  substituir: z.boolean().optional(),
})

export async function POST(req: NextRequest) {
  const auth = await getAuthContext()
  if (!auth.ok) return auth.response
  const gate = requireRole(auth.usuario, ['admin', 'advogado'])
  if (gate) return gate
  const { supabase, usuario } = auth

  const parsed = await validateBody(req, schemaVincular)
  if (!parsed.ok) return parsed.response
  const { clienteId, telefone, substituir } = parsed.data

  const digitos = apenasDigitos(telefone)
  if (digitos.length < 10 || digitos.length > 13) {
    return jsonError('Telefone inválido', 400)
  }

  // Cliente real do tenant (pré-cadastros do funil não são vinculáveis aqui).
  const { data: cliente, error: erroCliente } = await supabase
    .from('clientes')
    .select('id, nome, telefone')
    .eq('id', clienteId)
    .eq('tenant_id', usuario.tenant_id)
    .is('deleted_at', null)
    .neq('status_cadastro', 'pre_cadastro')
    .maybeSingle()
  if (erroCliente) return jsonError(erroCliente.message, 500)
  if (!cliente) return jsonError('Cliente não encontrado', 404)

  // O número já pertence a OUTRO cliente do tenant? O contexto casa o telefone
  // pegando o primeiro cliente por created_at (paridade com o by-phone da
  // Fase 5); vincular por cima deixaria o painel mostrando o cliente errado.
  const { data: existentes, error: erroExistentes } = await supabase
    .from('clientes')
    .select('id, nome, telefone')
    .eq('tenant_id', usuario.tenant_id)
    .is('deleted_at', null)
    .neq('status_cadastro', 'pre_cadastro')
    .not('telefone', 'is', null)
    .neq('id', cliente.id)
  if (erroExistentes) return jsonError(erroExistentes.message, 500)
  const conflito = (existentes ?? []).find((c) => mesmoTelefone(c.telefone, telefone))
  if (conflito) {
    return NextResponse.json(
      {
        error: 'Telefone já vinculado a outro cliente',
        code: 'TELEFONE_EM_USO',
        clienteNome: conflito.nome,
      },
      { status: 409 },
    )
  }

  // Já tem OUTRO telefone (mesmoTelefone tolera máscara/DDI/9º dígito — se for a
  // mesma linha, só normaliza sem exigir confirmação).
  const telefoneAtual = (cliente.telefone ?? '').trim()
  if (telefoneAtual && !mesmoTelefone(telefoneAtual, telefone) && !substituir) {
    return NextResponse.json(
      { error: 'Cliente já possui outro telefone', code: 'TELEFONE_DIFERENTE', telefoneAtual },
      { status: 409 },
    )
  }

  const { error: erroUpdate } = await supabase
    .from('clientes')
    .update({ telefone: telefone.trim() })
    .eq('id', cliente.id)
    .eq('tenant_id', usuario.tenant_id)
  if (erroUpdate) return jsonError(erroUpdate.message, 500)

  await logAudit({
    tenantId: usuario.tenant_id,
    userId: usuario.id,
    action: 'conversa.vinculada',
    resourceType: 'cliente',
    resourceId: cliente.id,
    metadata: {
      telefone: telefone.trim(),
      telefone_anterior: telefoneAtual || null,
      substituiu: Boolean(telefoneAtual && !mesmoTelefone(telefoneAtual, telefone)),
    },
  })

  return NextResponse.json({ ok: true, cliente: { id: cliente.id, nome: cliente.nome } })
}
