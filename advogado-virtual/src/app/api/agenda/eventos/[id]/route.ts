import { NextRequest, NextResponse } from 'next/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import { getAuthContext, requireRole } from '@/lib/auth'
import { jsonError, validateBody } from '@/lib/api'
import { logAudit } from '@/lib/audit'
import {
  PAPEIS_AGENDA,
  schemaEditar,
  COLUNAS_EVENTO,
  usuariosDoTenant,
  registroDoTenant,
  definirEnvolvidos,
} from '../_lib'

/**
 * Carrega o evento (tenant-scoped) e garante que evento `particular` só é
 * mutável pelo criador ou por admin. Retorna a linha ou uma NextResponse de erro.
 */
async function carregarEEditavel(
  supabase: Pick<SupabaseClient, 'from'>,
  id: string,
  usuario: { id: string; tenant_id: string; role: string },
): Promise<{ ok: true; evento: { id: string; visibilidade: string; created_by: string | null } } | { ok: false; response: NextResponse }> {
  const { data: evento } = await supabase
    .from('agenda_eventos')
    .select('id, visibilidade, created_by')
    .eq('id', id)
    .eq('tenant_id', usuario.tenant_id)
    .single()

  if (!evento) return { ok: false, response: jsonError('Evento não encontrado', 404) }

  if (
    evento.visibilidade === 'particular' &&
    evento.created_by !== usuario.id &&
    usuario.role !== 'admin'
  ) {
    return { ok: false, response: jsonError('Sem permissão para este evento particular', 403) }
  }
  return { ok: true, evento }
}

// PATCH /api/agenda/eventos/[id] — edita um agenda_evento.
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const auth = await getAuthContext()
  if (!auth.ok) return auth.response
  const { supabase, usuario } = auth

  const semPapel = requireRole(usuario, [...PAPEIS_AGENDA])
  if (semPapel) return semPapel

  const guard = await carregarEEditavel(supabase, id, usuario)
  if (!guard.ok) return guard.response

  const parsed = await validateBody(req, schemaEditar)
  if (!parsed.ok) return parsed.response
  const { envolvidos, ...campos } = parsed.data

  // Defesa de tenant p/ responsável e envolvidos informados.
  const alvos = [
    ...(campos.responsavel_id ? [campos.responsavel_id] : []),
    ...(envolvidos ?? []),
  ]
  if (!(await usuariosDoTenant(supabase, usuario.tenant_id, alvos))) {
    return jsonError('Responsável ou envolvido inválido para o tenant', 400)
  }

  // Defesa de tenant p/ cliente/processo, quando informados no patch.
  if (
    !(await registroDoTenant(supabase, 'clientes', usuario.tenant_id, campos.cliente_id)) ||
    !(await registroDoTenant(supabase, 'atendimentos', usuario.tenant_id, campos.process_id))
  ) {
    return jsonError('Cliente ou processo inválido para o tenant', 400)
  }

  if (Object.keys(campos).length > 0) {
    const { error } = await supabase
      .from('agenda_eventos')
      .update(campos)
      .eq('id', id)
      .eq('tenant_id', usuario.tenant_id)
    if (error) return jsonError(error.message, 500)
  }

  if (envolvidos !== undefined) {
    await definirEnvolvidos(supabase, id, envolvidos)
  }

  const { data: evento, error: errSel } = await supabase
    .from('agenda_eventos')
    .select(COLUNAS_EVENTO)
    .eq('id', id)
    .eq('tenant_id', usuario.tenant_id)
    .single()
  if (errSel || !evento) return jsonError(errSel?.message ?? 'Falha ao carregar evento', 500)

  await logAudit({
    tenantId: usuario.tenant_id,
    userId: usuario.id,
    action: 'agenda_evento.editar',
    resourceType: 'agenda_evento',
    resourceId: id,
    metadata: { campos: Object.keys(campos), envolvidosAlterados: envolvidos !== undefined },
  })

  return NextResponse.json({ evento })
}

// DELETE /api/agenda/eventos/[id] — exclui um agenda_evento (envolvidos caem por CASCADE).
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const auth = await getAuthContext()
  if (!auth.ok) return auth.response
  const { supabase, usuario } = auth

  const semPapel = requireRole(usuario, [...PAPEIS_AGENDA])
  if (semPapel) return semPapel

  const guard = await carregarEEditavel(supabase, id, usuario)
  if (!guard.ok) return guard.response

  const { error } = await supabase
    .from('agenda_eventos')
    .delete()
    .eq('id', id)
    .eq('tenant_id', usuario.tenant_id)
  if (error) return jsonError(error.message, 500)

  await logAudit({
    tenantId: usuario.tenant_id,
    userId: usuario.id,
    action: 'agenda_evento.excluir',
    resourceType: 'agenda_evento',
    resourceId: id,
  })

  return NextResponse.json({ ok: true })
}
