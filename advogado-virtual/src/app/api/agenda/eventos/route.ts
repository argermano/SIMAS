import { NextResponse } from 'next/server'
import { getAuthContext, requireRole } from '@/lib/auth'
import { jsonError, validateBody } from '@/lib/api'
import { logAudit } from '@/lib/audit'
import { conviteAposMutacao } from '@/lib/agenda/convites'
import {
  PAPEIS_AGENDA,
  schemaCriar,
  COLUNAS_EVENTO,
  usuariosDoTenant,
  registroDoTenant,
  definirEnvolvidos,
} from './_lib'

// POST /api/agenda/eventos — cria um agenda_evento (evento/prazo/audiência).
// created_by = usuario.id; origin = 'manual'; envolvidos M2M. Ver PLANO §3.
export async function POST(req: Request) {
  const auth = await getAuthContext()
  if (!auth.ok) return auth.response
  const { supabase, usuario } = auth

  const semPapel = requireRole(usuario, [...PAPEIS_AGENDA])
  if (semPapel) return semPapel

  const parsed = await validateBody(req, schemaCriar)
  if (!parsed.ok) return parsed.response
  const d = parsed.data

  // Defesa de tenant: responsável e envolvidos precisam ser usuários do tenant.
  const alvos = [...(d.responsavel_id ? [d.responsavel_id] : []), ...d.envolvidos]
  if (!(await usuariosDoTenant(supabase, usuario.tenant_id, alvos))) {
    return jsonError('Responsável ou envolvido inválido para o tenant', 400)
  }

  // Defesa de tenant: cliente/processo vinculados precisam ser do mesmo tenant.
  if (
    !(await registroDoTenant(supabase, 'clientes', usuario.tenant_id, d.cliente_id)) ||
    !(await registroDoTenant(supabase, 'atendimentos', usuario.tenant_id, d.process_id))
  ) {
    return jsonError('Cliente ou processo inválido para o tenant', 400)
  }

  const { data: evento, error } = await supabase
    .from('agenda_eventos')
    .insert({
      tenant_id: usuario.tenant_id,
      tipo: d.tipo,
      titulo: d.titulo,
      descricao: d.descricao ?? null,
      inicio: d.inicio,
      fim: d.fim ?? null,
      dia_todo: d.dia_todo,
      local: d.local ?? null,
      process_id: d.process_id ?? null,
      cliente_id: d.cliente_id ?? null,
      responsavel_id: d.responsavel_id ?? null,
      visibilidade: d.visibilidade,
      cor: d.cor ?? undefined,
      origin: 'manual',
      created_by: usuario.id,
    })
    .select(COLUNAS_EVENTO)
    .single()

  if (error || !evento) return jsonError(error?.message ?? 'Falha ao criar evento', 500)

  await definirEnvolvidos(supabase, evento.id, d.envolvidos)

  await logAudit({
    tenantId: usuario.tenant_id,
    userId: usuario.id,
    action: 'agenda_evento.criar',
    resourceType: 'agenda_evento',
    resourceId: evento.id,
    metadata: { tipo: d.tipo, visibilidade: d.visibilidade },
  })

  // Convite ICS por e-mail a responsável+envolvidos (best-effort; nunca falha a rota).
  await conviteAposMutacao(supabase, {
    tenantId: usuario.tenant_id,
    eventoId: evento.id,
    metodo: 'REQUEST',
  })

  return NextResponse.json({ evento }, { status: 201 })
}
