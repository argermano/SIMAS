import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getAuthContext, requireRole } from '@/lib/auth'
import { jsonError, validateBody } from '@/lib/api'
import { logAudit } from '@/lib/audit'
import { logger } from '@/lib/logger'
import { apenasDigitos } from '@/lib/conversas/telefone'
import { enviarAvisoWhatsApp } from '@/lib/processos/notificar'

// POST /api/atendimentos/[id]/whatsapp — envia uma mensagem ao cliente pelo
// canal de WhatsApp do escritório SEM sair da tela do atendimento (pedido do
// dono: faltou documento/pedido extra → o atendente dispara dali mesmo).
// Ato HUMANO explícito (equipe toda), no padrão do comunicar do financeiro.
// A mensagem enviada vira um REGISTRO no diário do atendimento — a linha do
// tempo documenta a comunicação com o cliente automaticamente.

const schema = z.object({ texto: z.string().trim().min(5).max(2000) })

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const auth = await getAuthContext()
  if (!auth.ok) return auth.response
  const gate = requireRole(auth.usuario, ['admin', 'advogado', 'colaborador'])
  if (gate) return gate
  const { supabase, usuario } = auth

  const parsed = await validateBody(req, schema)
  if (!parsed.ok) return parsed.response

  // Atendimento do tenant + telefone do cliente (RLS já limita ao tenant;
  // o filtro explícito é defesa em profundidade, padrão das rotas irmãs).
  const { data: atendimento } = await supabase
    .from('atendimentos')
    .select('id, cliente_id, clientes(id, nome, telefone)')
    .eq('id', id)
    .eq('tenant_id', usuario.tenant_id)
    .is('deleted_at', null)
    .single()
  if (!atendimento) return jsonError('Atendimento não encontrado', 404)

  const cliente = atendimento.clientes as unknown as { id: string; nome: string | null; telefone: string | null } | null
  const telefone = cliente?.telefone ?? null
  if (!telefone || apenasDigitos(telefone).length < 10) {
    return jsonError('Cliente sem telefone cadastrado — informe o WhatsApp no cartão de contato', 400)
  }

  const r = await enviarAvisoWhatsApp(telefone, parsed.data.texto)
  if (!r.ok) return jsonError('Falha ao enviar pelo WhatsApp — tente novamente', 502)

  // Registro no diário (best-effort: o envio já aconteceu; falha aqui só loga).
  const { error: erroRegistro } = await supabase
    .from('atendimento_registros')
    .insert({
      tenant_id: usuario.tenant_id,
      atendimento_id: id,
      user_id: usuario.id,
      texto: `📱 WhatsApp enviado ao cliente:\n${parsed.data.texto}`,
    })
  if (erroRegistro) {
    logger.error('atendimento.whatsapp.registro_falhou', { atendimentoId: id, tenantId: usuario.tenant_id })
  }

  await logAudit({
    tenantId: usuario.tenant_id,
    userId: usuario.id,
    action: 'atendimento.whatsapp_enviado',
    resourceType: 'atendimento',
    resourceId: id,
    metadata: { clienteId: cliente?.id },
  })

  return NextResponse.json({ ok: true })
}
