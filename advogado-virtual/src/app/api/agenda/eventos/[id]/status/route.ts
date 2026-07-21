import { NextRequest, NextResponse } from 'next/server'
import { getAuthContext, requireRole } from '@/lib/auth'
import { jsonError, validateBody } from '@/lib/api'
import { logAudit } from '@/lib/audit'
import { conviteAposMutacao } from '@/lib/agenda/convites'
import { calendarAdmin, agendarEspelhoUsuarios, coletarAfetadosEvento } from '@/lib/calendar/fila'
import { PAPEIS_AGENDA, schemaStatus, COLUNAS_EVENTO } from '../../_lib'

// POST /api/agenda/eventos/[id]/status — concluir / cancelar / reabrir.
// Evento particular só pode ser mexido pelo criador ou admin. Ver PLANO §3.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const auth = await getAuthContext()
  if (!auth.ok) return auth.response
  const { supabase, usuario } = auth

  const semPapel = requireRole(usuario, [...PAPEIS_AGENDA])
  if (semPapel) return semPapel

  const parsed = await validateBody(req, schemaStatus)
  if (!parsed.ok) return parsed.response
  const { acao } = parsed.data

  const { data: atual } = await supabase
    .from('agenda_eventos')
    .select('id, visibilidade, created_by')
    .eq('id', id)
    .eq('tenant_id', usuario.tenant_id)
    .single()

  if (!atual) return jsonError('Evento não encontrado', 404)
  if (
    atual.visibilidade === 'particular' &&
    atual.created_by !== usuario.id &&
    usuario.role !== 'admin'
  ) {
    return jsonError('Sem permissão para este evento particular', 403)
  }

  const patch =
    acao === 'concluir'
      ? { status: 'concluida', concluido_em: new Date().toISOString() }
      : acao === 'cancelar'
        ? { status: 'cancelada', concluido_em: null }
        : { status: 'a_concluir', concluido_em: null }

  const { data: evento, error } = await supabase
    .from('agenda_eventos')
    .update(patch)
    .eq('id', id)
    .eq('tenant_id', usuario.tenant_id)
    .select(COLUNAS_EVENTO)
    .single()

  if (error || !evento) return jsonError(error?.message ?? 'Falha ao atualizar status', 500)

  await logAudit({
    tenantId: usuario.tenant_id,
    userId: usuario.id,
    action: 'agenda_evento.status',
    resourceType: 'agenda_evento',
    resourceId: id,
    metadata: { acao, status: patch.status },
  })

  // Convite ICS best-effort: cancelar => CANCEL; reabrir => REQUEST (restaura
  // o compromisso no calendário de quem recebeu o CANCEL). Concluir não envia.
  if (acao === 'cancelar' || acao === 'reabrir') {
    await conviteAposMutacao(supabase, {
      tenantId: usuario.tenant_id,
      eventoId: id,
      metodo: acao === 'cancelar' ? 'CANCEL' : 'REQUEST',
      incrementarSequence: true,
    })
  }

  // Espelho: cancelar REMOVE do calendário; concluir/reabrir reconcilia (o evento
  // permanece, só atualizado). Reconcilia idempotente. No-op se inerte.
  const calAdmin = calendarAdmin()
  await agendarEspelhoUsuarios(calAdmin, usuario.tenant_id, await coletarAfetadosEvento(calAdmin, id))

  return NextResponse.json({ evento })
}
