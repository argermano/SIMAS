import { NextResponse } from 'next/server'
import { assinaturaCalcomValida } from '@/lib/funil/auth-integracao'
import { adminFunil, tenantFunil, upsertLeadComPreCadastro, registrarEvento } from '@/lib/funil/leads'
import { mesmoTelefone } from '@/lib/funil/telefone'
import { podeMover, type EtapaFunil } from '@/lib/funil/regras'
import { logger } from '@/lib/logger'

// POST /api/funil/webhooks/calcom — Cal.com Cloud (2 contas). Verifica HMAC
// sobre o CORPO BRUTO (fail-closed). BOOKING_CREATED (idempotente por uid) e
// BOOKING_CANCELLED (marca badge). Ver spec §2.1/§5.
export async function POST(req: Request) {
  const raw = await req.text()
  if (!assinaturaCalcomValida(raw, req.headers.get('x-cal-signature-256'))) {
    return new NextResponse('Unauthorized', { status: 401 })
  }

  const tenantId = tenantFunil()
  if (!tenantId) return new NextResponse('FUNIL_TENANT_ID ausente', { status: 500 })

  let evento: { triggerEvent?: string; payload?: Record<string, unknown> }
  try { evento = JSON.parse(raw) } catch { return new NextResponse('Bad Request', { status: 400 }) }

  const trigger = evento.triggerEvent
  const p = (evento.payload ?? {}) as Record<string, unknown>
  const uid = (p.uid as string) ?? null
  const admin = adminFunil()

  try {
    if (trigger === 'BOOKING_CANCELLED') {
      if (uid) {
        await admin.from('funil_leads')
          .update({ consulta_cancelada: true, updated_at: new Date().toISOString() })
          .eq('tenant_id', tenantId).eq('cal_booking_uid', uid)
      }
      return NextResponse.json({ ok: true })
    }

    if (trigger === 'BOOKING_CREATED') {
      const attendee = (Array.isArray(p.attendees) ? p.attendees[0] : {}) as Record<string, unknown>
      const email = (attendee.email as string) ?? null
      const nome = (attendee.name as string) ?? null
      const telefone = extrairTelefone(p, attendee)
      const startTime = p.startTime as string | undefined
      const dataISO = startTime && !Number.isNaN(Date.parse(startTime)) ? new Date(startTime).toISOString() : null
      const meetUrl = extrairMeet(p)

      // Idempotência: já existe lead com este uid?
      if (uid) {
        const { data: existente } = await admin.from('funil_leads')
          .select('id').eq('tenant_id', tenantId).eq('cal_booking_uid', uid).maybeSingle()
        if (existente) {
          const patch: Record<string, unknown> = { updated_at: new Date().toISOString(), consulta_cancelada: false }
          if (dataISO) patch.consulta_data = dataISO
          if (meetUrl) patch.meet_url = meetUrl
          await admin.from('funil_leads').update(patch).eq('id', existente.id)
          return NextResponse.json({ ok: true, idempotente: true })
        }
      }

      // Localiza lead ativo por telefone/e-mail; senão cria (com pré-cadastro).
      const { data: leads } = await admin.from('funil_leads')
        .select('id, telefone, email, etapa')
        .eq('tenant_id', tenantId)
        .not('etapa', 'in', '(contrato_fechado,perdido)')
      let lead = (leads ?? []).find((l) =>
        (telefone && mesmoTelefone(l.telefone as string, telefone)) ||
        (email && (l.email as string)?.toLowerCase() === email.toLowerCase()),
      ) as { id: string; etapa: EtapaFunil } | undefined

      if (!lead && telefone) {
        const r = await upsertLeadComPreCadastro(admin, tenantId, { telefone, nomeInformado: nome, email, ator: 'sistema' })
        lead = { id: r.leadId, etapa: 'novo_lead' }
      }
      if (!lead) {
        logger.warn('funil.calcom.sem_match', { uid })
        return NextResponse.json({ ok: true, semMatch: true })
      }

      const patch: Record<string, unknown> = { updated_at: new Date().toISOString(), consulta_cancelada: false }
      if (uid) patch.cal_booking_uid = uid
      if (dataISO) patch.consulta_data = dataISO
      if (meetUrl) patch.meet_url = meetUrl
      const move = podeMover('sistema', lead.etapa, 'consulta_agendada')
      if (move) patch.etapa = 'consulta_agendada'
      await admin.from('funil_leads').update(patch).eq('id', lead.id)
      if (move) await registrarEvento(admin, lead.id, lead.etapa, 'consulta_agendada', 'sistema', null, 'Consulta agendada (Cal.com)')
      return NextResponse.json({ ok: true })
    }

    return NextResponse.json({ ok: true, ignorado: trigger })
  } catch (err) {
    logger.error('funil.calcom.falha', { trigger, uid }, err)
    return new NextResponse('Erro', { status: 500 })
  }
}

function extrairTelefone(p: Record<string, unknown>, attendee: Record<string, unknown>): string | null {
  const r = (p.responses ?? {}) as Record<string, { value?: unknown }>
  const cand = [
    attendee.phoneNumber,
    r.phone?.value, r.attendeePhoneNumber?.value, r.smsReminderNumber?.value,
  ].find((v) => typeof v === 'string' && (v as string).replace(/\D/g, '').length >= 10)
  return (cand as string) ?? null
}

function extrairMeet(p: Record<string, unknown>): string | null {
  const loc = p.location as string | undefined
  if (loc && /^https?:\/\//.test(loc)) return loc
  const meta = p.metadata as { videoCallUrl?: string } | undefined
  return meta?.videoCallUrl ?? null
}
