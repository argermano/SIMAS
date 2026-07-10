import { NextResponse } from 'next/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { jsonError, validateBody } from '@/lib/api'
import { logAudit } from '@/lib/audit'
import { autorizadoIntegracao } from '@/lib/funil/auth-integracao'
import { logger } from '@/lib/logger'
import {
  schemaIntegracao,
  COLUNAS_EVENTO,
  usuariosDoTenant,
  registroDoTenant,
  definirEnvolvidos,
} from '../_lib'

// POST /api/agenda/eventos/integracao — o bot (ai-attendant) cria um agenda_evento.
// Auth: x-simas-token (autorizadoIntegracao). Escopo: FUNIL_TENANT_ID. origin='bot',
// created_by=null. NUNCA cria prazo sem `inicio` (garantido pelo schema). Ver PLANO §3.
export async function POST(req: Request) {
  if (!autorizadoIntegracao(req)) {
    return new NextResponse('Unauthorized', { status: 401 })
  }

  const tenantId = process.env.FUNIL_TENANT_ID
  if (!tenantId) return jsonError('FUNIL_TENANT_ID não configurado', 500)

  const parsed = await validateBody(req, schemaIntegracao)
  if (!parsed.ok) return parsed.response
  const d = parsed.data

  const admin = createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )

  // Defesa de tenant: responsável/envolvidos precisam pertencer ao tenant do funil.
  const alvos = [...(d.responsavel_id ? [d.responsavel_id] : []), ...d.envolvidos]
  if (!(await usuariosDoTenant(admin, tenantId, alvos))) {
    return jsonError('Responsável ou envolvido inválido para o tenant', 400)
  }

  // Defesa de tenant: cliente vinculado precisa ser do tenant do funil.
  if (!(await registroDoTenant(admin, 'clientes', tenantId, d.cliente_id))) {
    return jsonError('Cliente inválido para o tenant', 400)
  }

  try {
    const { data: evento, error } = await admin
      .from('agenda_eventos')
      .insert({
        tenant_id: tenantId,
        tipo: d.tipo,
        titulo: d.titulo,
        descricao: d.descricao ?? null,
        inicio: d.inicio,
        fim: d.fim ?? null,
        dia_todo: d.dia_todo,
        local: d.local ?? null,
        cliente_id: d.cliente_id ?? null,
        responsavel_id: d.responsavel_id ?? null,
        visibilidade: 'escritorio',
        cor: d.cor ?? undefined,
        origin: 'bot',
        origin_reference: d.origin_reference ?? null,
        created_by: null,
      })
      .select(COLUNAS_EVENTO)
      .single()

    if (error || !evento) return jsonError(error?.message ?? 'Falha ao criar evento', 500)

    await definirEnvolvidos(admin, evento.id, d.envolvidos)

    await logAudit({
      tenantId,
      userId: null,
      action: 'agenda_evento.criar',
      resourceType: 'agenda_evento',
      resourceId: evento.id,
      metadata: { tipo: d.tipo, origin: 'bot', origin_reference: d.origin_reference ?? null },
    })

    return NextResponse.json({ evento }, { status: 201 })
  } catch (err) {
    logger.error('agenda.eventos.integracao_falha', {}, err)
    return jsonError('Falha ao criar evento', 500)
  }
}
