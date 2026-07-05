import { NextResponse } from 'next/server'
import { jsonError } from '@/lib/api'
import { autorizadoIntegracao } from '@/lib/funil/auth-integracao'
import { adminFunil, tenantFunil, upsertLeadComPreCadastro } from '@/lib/funil/leads'
import { logger } from '@/lib/logger'

// POST /api/funil/leads — ai-attendant: primeira mensagem de nº desconhecido.
// Cria/atualiza o lead + pré-cadastro do cliente (spec §2.1). Idempotente.
export async function POST(req: Request) {
  if (!autorizadoIntegracao(req)) return new NextResponse('Unauthorized', { status: 401 })

  const tenantId = tenantFunil()
  if (!tenantId) return jsonError('FUNIL_TENANT_ID não configurado', 500)

  const body = (await req.json().catch(() => ({}))) as {
    telefone?: string; nomeInformado?: string; unidade?: string; chatwootConversationId?: number
    ultimaMensagem?: string; ultimaMensagemAutor?: string; ultimaMensagemEm?: string
  }
  if (!body.telefone) return jsonError('telefone é obrigatório', 400)

  try {
    const r = await upsertLeadComPreCadastro(adminFunil(), tenantId, {
      telefone: body.telefone,
      nomeInformado: body.nomeInformado,
      unidade: body.unidade,
      chatwootConversationId: body.chatwootConversationId,
      ultimaMensagem: body.ultimaMensagem,
      ultimaMensagemAutor: body.ultimaMensagemAutor,
      ultimaMensagemEm: body.ultimaMensagemEm,
      ator: 'ia',
    })
    return NextResponse.json({ leadId: r.leadId, novo: r.novo, clienteExistente: r.clienteExistente })
  } catch (err) {
    logger.error('funil.leads.upsert_falha', {}, err)
    return jsonError('Falha ao registrar lead', 500)
  }
}
