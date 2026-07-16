import { NextResponse } from 'next/server'
import { getAuthContext, requireRole } from '@/lib/auth'
import { jsonError } from '@/lib/api'
import { cadastroCompleto } from '@/lib/funil/regras'

// GET /api/funil/leads/:id/detalhes — carrega os blocos do drawer (Cliente,
// Documentos, timeline). Sessão + RLS (o supabase do getAuthContext já isola por
// tenant). Não devolve dados sensíveis do caso (LGPD) — só metadados de docs.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const auth = await getAuthContext()
  if (!auth.ok) return auth.response
  // Funil é gestão comercial: SÓ administrador (decisão do dono, 2026-07-16).
  {
    const semRole = requireRole(auth.usuario, ['admin'])
    if (semRole) return semRole
  }
  const { supabase, usuario } = auth

  const { data: lead } = await supabase
    .from('funil_leads')
    .select('id, cliente_id, area')
    .eq('id', id)
    .eq('tenant_id', usuario.tenant_id)
    .single()
  if (!lead) return jsonError('Lead não encontrado', 404)

  // Cliente — presença de nome/cpf/endereço define se o cadastro está completo
  // (critério de promoção no contrato_fechado). Não retornamos o CPF em si.
  const { data: cliente } = await supabase
    .from('clientes')
    .select('id, nome, cpf, endereco, status_cadastro')
    .eq('id', lead.cliente_id)
    .single()

  const completo = cadastroCompleto(cliente)

  // Documentos do cliente: contratos + peças (via atendimentos do cliente).
  const [{ data: contratos }, { data: atendimentos }] = await Promise.all([
    supabase
      .from('contratos_honorarios')
      .select('id, titulo, status, created_at')
      .eq('cliente_id', lead.cliente_id)
      .order('created_at', { ascending: false }),
    supabase
      .from('atendimentos')
      .select('id')
      .eq('cliente_id', lead.cliente_id),
  ])

  const atendimentoIds = (atendimentos ?? []).map((a) => a.id)
  let pecas: { id: string; tipo: string; area: string; status: string; created_at: string }[] = []
  if (atendimentoIds.length) {
    const { data } = await supabase
      .from('pecas')
      .select('id, tipo, area, status, created_at')
      .in('atendimento_id', atendimentoIds)
      .order('created_at', { ascending: false })
    pecas = data ?? []
  }

  const { data: eventos } = await supabase
    .from('funil_lead_eventos')
    .select('id, de_etapa, para_etapa, ator, ator_nome, observacao, created_at')
    .eq('lead_id', id)
    .order('created_at', { ascending: false })

  return NextResponse.json({
    cliente: cliente
      ? { id: cliente.id, nome: cliente.nome, status_cadastro: cliente.status_cadastro, cadastroCompleto: completo }
      : null,
    contratos: contratos ?? [],
    pecas,
    eventos: eventos ?? [],
  })
}
