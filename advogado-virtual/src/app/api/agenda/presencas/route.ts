import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getAuthContext, requireRole } from '@/lib/auth'
import { jsonError, validateBody } from '@/lib/api'
import { logAudit } from '@/lib/audit'
import { UNIDADES, type UnidadePresenca } from '@/lib/agenda/presenca'

// /api/agenda/presencas — presença da advogada por unidade (Peça 3, Agenda Conectada).
// GET  ?de=&ate=&userId=  lista (qualquer papel com acesso à agenda)
// PUT  {userId,data,unidade,observacao?}  upsert por (tenant,user,data) — admin/advogado
// DELETE ?userId=&data=  remove a presença do dia — admin/advogado
// Tenant scoping explícito em toda query (além do RLS da sessão).

const PAPEIS_AGENDA = ['admin', 'advogado', 'colaborador']
const PAPEIS_GESTAO = ['admin', 'advogado']

const DATA_ISO = /^\d{4}-\d{2}-\d{2}$/
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const COLUNAS = 'id, user_id, data, unidade, observacao, created_by, created_at, updated_at'

export async function GET(req: NextRequest) {
  const auth = await getAuthContext()
  if (!auth.ok) return auth.response
  const gate = requireRole(auth.usuario, PAPEIS_AGENDA)
  if (gate) return gate
  const { supabase, usuario } = auth

  const { searchParams } = new URL(req.url)
  const de = searchParams.get('de')
  const ate = searchParams.get('ate')
  const userId = searchParams.get('userId')
  if (de && !DATA_ISO.test(de)) return jsonError('Parâmetro "de" inválido (YYYY-MM-DD)', 400)
  if (ate && !DATA_ISO.test(ate)) return jsonError('Parâmetro "ate" inválido (YYYY-MM-DD)', 400)
  if (userId && !UUID_RE.test(userId)) return jsonError('Parâmetro "userId" inválido (UUID)', 400)

  let query = supabase
    .from('presencas')
    .select(COLUNAS)
    .eq('tenant_id', usuario.tenant_id)
    .order('data', { ascending: true })
  if (de) query = query.gte('data', de)
  if (ate) query = query.lte('data', ate)
  if (userId) query = query.eq('user_id', userId)

  const { data, error } = await query
  if (error) return jsonError('Erro ao listar presenças', 500)

  return NextResponse.json({ presencas: data ?? [] })
}

const schemaPut = z.object({
  userId: z.string().uuid(),
  data: z.string().regex(DATA_ISO, 'data deve ser YYYY-MM-DD'),
  unidade: z.enum(UNIDADES as [UnidadePresenca, ...UnidadePresenca[]]),
  observacao: z.string().max(500).nullish(),
})

export async function PUT(req: NextRequest) {
  const auth = await getAuthContext()
  if (!auth.ok) return auth.response
  const gate = requireRole(auth.usuario, PAPEIS_GESTAO)
  if (gate) return gate
  const { supabase, usuario } = auth

  const parsed = await validateBody(req, schemaPut)
  if (!parsed.ok) return parsed.response
  const d = parsed.data

  // Defesa de tenant: a pessoa marcada precisa pertencer ao tenant.
  const { data: alvo } = await supabase
    .from('users')
    .select('id')
    .eq('id', d.userId)
    .eq('tenant_id', usuario.tenant_id)
    .maybeSingle()
  if (!alvo) return jsonError('Usuário inválido para o tenant', 400)

  const { data: presenca, error } = await supabase
    .from('presencas')
    .upsert(
      {
        tenant_id: usuario.tenant_id,
        user_id: d.userId,
        data: d.data,
        unidade: d.unidade,
        observacao: d.observacao ?? null,
        created_by: usuario.id,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'tenant_id,user_id,data' },
    )
    .select(COLUNAS)
    .single()
  if (error || !presenca) return jsonError('Erro ao salvar presença', 500)

  await logAudit({
    tenantId: usuario.tenant_id,
    userId: usuario.id,
    action: 'agenda.presenca.upsert',
    resourceType: 'presenca',
    resourceId: presenca.id,
    metadata: { userId: d.userId, data: d.data, unidade: d.unidade },
  })

  return NextResponse.json({ presenca })
}

export async function DELETE(req: NextRequest) {
  const auth = await getAuthContext()
  if (!auth.ok) return auth.response
  const gate = requireRole(auth.usuario, PAPEIS_GESTAO)
  if (gate) return gate
  const { supabase, usuario } = auth

  const { searchParams } = new URL(req.url)
  const userId = searchParams.get('userId')
  const data = searchParams.get('data')
  if (!userId || !UUID_RE.test(userId) || !data || !DATA_ISO.test(data)) {
    return jsonError('Parâmetros "userId" (UUID) e "data" (YYYY-MM-DD) são obrigatórios', 400)
  }

  const { data: removidas, error } = await supabase
    .from('presencas')
    .delete()
    .eq('tenant_id', usuario.tenant_id)
    .eq('user_id', userId)
    .eq('data', data)
    .select('id')
  if (error) return jsonError('Erro ao remover presença', 500)
  if (!removidas || removidas.length === 0) return jsonError('Presença não encontrada', 404)

  await logAudit({
    tenantId: usuario.tenant_id,
    userId: usuario.id,
    action: 'agenda.presenca.delete',
    resourceType: 'presenca',
    resourceId: removidas[0].id,
    metadata: { userId, data },
  })

  return NextResponse.json({ ok: true })
}
