import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { getAuthContext, requireRole } from '@/lib/auth'
import { jsonError, validateBody } from '@/lib/api'
import { logAudit } from '@/lib/audit'
import { enviarAvisoWhatsApp } from '@/lib/processos/notificar'

export const maxDuration = 30

const schema = z.object({
  acao: z.enum(['aprovar', 'descartar']),
  texto: z.string().max(2000).optional(),
})

function adminClient() {
  return createAdminClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
}

// POST /api/processos/notificacoes/[movimentoId] — aprova (envia) ou descarta um
// aviso da fila. Aprovar com `texto` usa o texto editado. admin/advogado.
export async function POST(req: Request, { params }: { params: Promise<{ movimentoId: string }> }) {
  const auth = await getAuthContext()
  if (!auth.ok) return auth.response
  const { supabase, usuario } = auth
  const gate = requireRole(usuario, ['admin', 'advogado'])
  if (gate) return gate
  const { movimentoId } = await params

  const parsed = await validateBody(req, schema)
  if (!parsed.ok) return parsed.response
  const { acao, texto } = parsed.data

  // Carrega o movimento garantindo o tenant (RLS via user client) + dados p/ envio
  const { data: mov } = await supabase
    .from('processo_movimentos')
    .select('id, notif_status, notif_texto, processo:processos!inner(id, tenant_id, cliente:clientes(id, telefone))')
    .eq('id', movimentoId)
    .single()

  if (!mov) return jsonError('Aviso não encontrado.', 404)

  type MovJoin = {
    id: string
    notif_status: string
    notif_texto: string | null
    processo: { id: string; tenant_id: string; cliente: { id: string; telefone: string | null } | null }
  }
  const m = mov as unknown as MovJoin
  if (m.processo.tenant_id !== usuario.tenant_id) return jsonError('Aviso não encontrado.', 404)
  if (!['pendente', 'erro'].includes(m.notif_status)) {
    return jsonError('Este aviso já foi processado.', 409)
  }

  const admin = adminClient()

  if (acao === 'descartar') {
    // Claim atômico: só quem tirar de pendente/erro descarta (evita corrida).
    const { data: claim } = await admin
      .from('processo_movimentos')
      .update({ notif_status: 'descartada', notif_aprovada_por: usuario.id })
      .eq('id', movimentoId)
      .in('notif_status', ['pendente', 'erro'])
      .select('id')
    if (!claim || claim.length === 0) return jsonError('Este aviso já foi processado.', 409)
    await logAudit({
      tenantId: usuario.tenant_id, userId: usuario.id, action: 'processo.notificacao_descartada',
      resourceType: 'processo', resourceId: m.processo.id, metadata: { movimento_id: movimentoId },
    })
    return NextResponse.json({ ok: true, notif_status: 'descartada' })
  }

  // aprovar → envia
  const telefone = m.processo.cliente?.telefone
  const textoFinal = (texto?.trim() || m.notif_texto || '').trim()
  if (!telefone) return jsonError('Cliente sem telefone no cadastro.', 400)
  if (!textoFinal) return jsonError('Texto do aviso vazio.', 400)

  // CLAIM atômico ANTES de enviar: um único request muda pendente/erro→aprovada.
  // Dois cliques/dois advogados concorrentes: só um passa; o outro recebe 409 e
  // NÃO envia de novo (garante idempotência — nunca 2 avisos do mesmo movimento).
  const { data: claim } = await admin
    .from('processo_movimentos')
    .update({ notif_status: 'aprovada', notif_texto: textoFinal, notif_aprovada_por: usuario.id })
    .eq('id', movimentoId)
    .in('notif_status', ['pendente', 'erro'])
    .select('id')
  if (!claim || claim.length === 0) return jsonError('Este aviso já foi processado.', 409)

  const res = await enviarAvisoWhatsApp(telefone, textoFinal)
  if (!res.ok) {
    await admin.from('processo_movimentos').update({ notif_status: 'erro' }).eq('id', movimentoId)
    return jsonError('Falha ao enviar pelo WhatsApp. Tente novamente.', 502)
  }

  await admin
    .from('processo_movimentos')
    .update({ notif_status: 'enviada', notif_enviada_em: new Date().toISOString() })
    .eq('id', movimentoId)

  await logAudit({
    tenantId: usuario.tenant_id, userId: usuario.id, action: 'processo.notificacao_enviada',
    resourceType: 'processo', resourceId: m.processo.id, metadata: { movimento_id: movimentoId, aprovado: true },
  })

  return NextResponse.json({ ok: true, notif_status: 'enviada' })
}
