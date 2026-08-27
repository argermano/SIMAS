import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getAuthContext } from '@/lib/auth'
import { jsonError, validateBody } from '@/lib/api'
import { logger } from '@/lib/logger'
import { modeloDaSessao } from '@/lib/ia/sessao/driver-messages'
import {
  adminSessoes,
  carregarPecaDoTenant,
  inserirTurno,
  listarSessoesDaPeca,
  sessaoAtivaDaPeca,
} from '@/lib/ia/sessao/sessoes'

const schemaCriar = z.object({
  // Escolha do advogado na CRIAÇÃO — o modelo é fixo pelo resto da sessão
  // (trocá-lo no meio invalidaria todo o cache de prompt).
  versao: z.enum(['padrao', 'avancado']).optional(),
  /** Teto de custo de lista desta sessão em USD (opcional; Fase 3 usa por padrão). */
  orcamentoUsd: z.number().positive().max(100).optional(),
})

// POST /api/pecas/[id]/sessao — abre uma sessão de lapidação para a peça.
// Uma sessão ATIVA por peça de cada vez: com duas, dois históricos disputariam
// o mesmo texto e o "a peça mudou" viraria regra em vez de exceção.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: pecaId } = await params

  const auth = await getAuthContext()
  if (!auth.ok) return auth.response
  const { supabase, usuario } = auth

  const parsed = await validateBody(req, schemaCriar)
  if (!parsed.ok) return parsed.response

  const peca = await carregarPecaDoTenant(supabase, pecaId, usuario.tenant_id)
  if (!peca) return jsonError('Peça não encontrada', 404)

  // A sessão LAPIDA uma peça existente — sem texto não há o que propor. Falhar
  // aqui é melhor que abrir uma sessão que só erraria na primeira rodada.
  if (!(peca.conteudo_markdown ?? '').trim()) {
    return jsonError('A peça ainda não tem conteúdo para lapidar', 400)
  }
  if (!peca.atendimento_id) {
    return jsonError('A peça não está ligada a um atendimento — sem dossiê para a sessão', 400)
  }

  const admin = adminSessoes()

  const ativa = await sessaoAtivaDaPeca(admin, pecaId)
  if (ativa) {
    return jsonError('Esta peça já tem uma sessão de lapidação em andamento.', 409, {
      code: 'SESSAO_ATIVA',
      sessaoId: ativa.id,
    })
  }

  const { modelo, versao } = modeloDaSessao(parsed.data.versao)

  const { data: sessao, error } = await admin
    .from('pecas_sessoes')
    .insert({
      tenant_id: usuario.tenant_id,
      peca_id: pecaId,
      driver: 'messages',
      modelo,
      effort: versao === 'avancado' ? 'high' : null,
      status: 'ativa',
      orcamento_usd: parsed.data.orcamentoUsd ?? null,
      versao_inicial: peca.versao ?? 1,
      criada_por: usuario.id,
    })
    .select('*')
    .single()

  if (error || !sessao) {
    logger.error('ia.sessao.criar_falhou', { pecaId }, error)
    return jsonError('Não foi possível abrir a sessão de lapidação', 500)
  }

  // Turno 0: a abertura. Sem `payload.blocos` de propósito — é registro para o
  // painel, não uma fala que deva voltar ao modelo em toda rodada.
  await inserirTurno(admin, {
    sessaoId: sessao.id as string,
    numero: 0,
    papel: 'sistema',
    tipo: 'ferramenta',
    conteudo: `Sessão de lapidação aberta sobre a versão ${peca.versao ?? 1} da peça.`,
    payload: { abertura: true, modelo, versao_peca: peca.versao ?? 1 },
    criadoPor: usuario.id,
  })

  logger.info('ia.sessao.criada', {
    sessaoId: sessao.id,
    pecaId,
    modelo,
    versaoPeca: peca.versao ?? 1,
  })

  return NextResponse.json({ sessao }, { status: 201 })
}

// GET /api/pecas/[id]/sessao — sessões da peça, mais recente primeiro.
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: pecaId } = await params

  const auth = await getAuthContext()
  if (!auth.ok) return auth.response
  const { supabase, usuario } = auth

  const peca = await carregarPecaDoTenant(supabase, pecaId, usuario.tenant_id)
  if (!peca) return jsonError('Peça não encontrada', 404)

  const sessoes = await listarSessoesDaPeca(adminSessoes(), pecaId, usuario.tenant_id)
  return NextResponse.json({ sessoes, versaoPeca: peca.versao ?? 1 })
}
