import { NextResponse } from 'next/server'
import { jsonError } from '@/lib/api'
import { autorizadoIntegracao } from '@/lib/funil/auth-integracao'
import { adminFunil, tenantFunil, upsertLeadComPreCadastro, registrarEvento } from '@/lib/funil/leads'
import { mesmoTelefone } from '@/lib/funil/telefone'
import { podeMover, type EtapaFunil } from '@/lib/funil/regras'
import { logger } from '@/lib/logger'

// POST /api/funil/leads/by-phone/:telefone/agendamento — ai-attendant: consulta
// agendada (spec §6). Grava o booking e move para CONSULTA_AGENDADA quando as
// regras permitirem (não desfaz avanço humano). Cria o lead se ainda não existir.
export async function POST(req: Request, { params }: { params: Promise<{ telefone: string }> }) {
  if (!autorizadoIntegracao(req)) return new NextResponse('Unauthorized', { status: 401 })

  const tenantId = tenantFunil()
  if (!tenantId) return jsonError('FUNIL_TENANT_ID não configurado', 500)

  const { telefone } = await params
  const body = (await req.json().catch(() => ({}))) as {
    calBookingUid?: string; quando?: string; consultaDataISO?: string
    formato?: string; tipo?: string; area?: string; meetUrl?: string; nome?: string; email?: string
  }
  const admin = adminFunil()

  // Localiza ou cria o lead.
  const { data: leads } = await admin
    .from('funil_leads')
    .select('id, telefone, etapa')
    .eq('tenant_id', tenantId)
    .not('etapa', 'in', '(contrato_fechado,perdido)')
  let lead = (leads ?? []).find((l) => mesmoTelefone(l.telefone as string, telefone)) as
    | { id: string; etapa: EtapaFunil }
    | undefined

  if (!lead) {
    try {
      const r = await upsertLeadComPreCadastro(admin, tenantId, {
        telefone, nomeInformado: body.nome, email: body.email, ator: 'ia',
      })
      lead = { id: r.leadId, etapa: 'novo_lead' }
    } catch (err) {
      logger.error('funil.agendamento.upsert_falha', {}, err)
      return jsonError('Falha ao registrar lead', 500)
    }
  }

  // Data da consulta: ISO explícito > `quando` parseável.
  const dataISO = body.consultaDataISO && !Number.isNaN(Date.parse(body.consultaDataISO))
    ? new Date(body.consultaDataISO).toISOString()
    : (body.quando && !Number.isNaN(Date.parse(body.quando)) ? new Date(body.quando).toISOString() : null)

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString(), consulta_cancelada: false }
  if (body.calBookingUid) patch.cal_booking_uid = body.calBookingUid
  if (dataISO) patch.consulta_data = dataISO
  if (body.formato) patch.consulta_formato = body.formato
  if (body.meetUrl) patch.meet_url = body.meetUrl
  if (body.area) patch.area = body.area
  if (body.email) patch.email = body.email
  if (body.nome) patch.nome_informado = body.nome

  const move = podeMover('ia', lead.etapa, 'consulta_agendada')
  if (move) patch.etapa = 'consulta_agendada'

  await admin.from('funil_leads').update(patch).eq('id', lead.id)
  if (move) await registrarEvento(admin, lead.id, lead.etapa, 'consulta_agendada', 'ia', null, 'Consulta agendada')

  return NextResponse.json({ ok: true, leadId: lead.id, movido: move })
}
