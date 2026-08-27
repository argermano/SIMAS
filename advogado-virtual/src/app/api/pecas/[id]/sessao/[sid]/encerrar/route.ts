import { NextRequest, NextResponse } from 'next/server'
import { getAuthContext } from '@/lib/auth'
import { jsonError } from '@/lib/api'
import { logger } from '@/lib/logger'
import { adminSessoes, carregarPecaDoTenant, carregarSessao, inserirTurno } from '@/lib/ia/sessao/sessoes'

export const maxDuration = 30

// POST /api/pecas/[id]/sessao/[sid]/encerrar — fecha a sessão.
//
// Encerrar é só mudar o estado: turnos e propostas continuam lá (a sessão
// encerrada vira leitura). Uma proposta pendente NÃO é aplicada nem descartada
// aqui — quem decide sobre o texto da peça é sempre o endpoint de decisão.
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; sid: string }> },
) {
  const { id: pecaId, sid } = await params

  const auth = await getAuthContext()
  if (!auth.ok) return auth.response
  const { supabase, usuario } = auth

  const peca = await carregarPecaDoTenant(supabase, pecaId, usuario.tenant_id)
  if (!peca) return jsonError('Peça não encontrada', 404)

  const admin = adminSessoes()
  const sessao = await carregarSessao(admin, { sessaoId: sid, pecaId, tenantId: usuario.tenant_id })
  if (!sessao) return jsonError('Sessão não encontrada', 404)

  if (sessao.status === 'encerrada') {
    return NextResponse.json({ ok: true, sessao })
  }

  const agora = new Date().toISOString()
  const { data, error } = await admin
    .from('pecas_sessoes')
    .update({ status: 'encerrada', encerrada_em: agora, atualizada_em: agora })
    .eq('id', sessao.id)
    .select('*')
    .single()

  if (error) {
    logger.error('ia.sessao.encerrar.falha', { pecaId, sessaoId: sid }, error)
    return jsonError('Não foi possível encerrar a sessão', 500)
  }

  await inserirTurno(admin, {
    sessaoId: sessao.id,
    papel: 'sistema',
    tipo: 'ferramenta',
    conteudo: 'Sessão encerrada pelo advogado.',
    payload: { encerramento: true },
    criadoPor: usuario.id,
  })

  logger.info('ia.sessao.encerrada', {
    sessaoId: sessao.id,
    pecaId,
    custoUsd: Number(sessao.custo_lista_usd ?? 0),
  })

  return NextResponse.json({ ok: true, sessao: data })
}
