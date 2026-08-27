import { NextRequest } from 'next/server'
import { z } from 'zod'
import { getAuthContext } from '@/lib/auth'
import { jsonError, validateBody } from '@/lib/api'
import { mensagemCotaExcedida, verificarCota } from '@/lib/anthropic/quota'
import { logger } from '@/lib/logger'
import { executarRodada, ENDPOINT_SESSAO } from '@/lib/ia/sessao/rodada'
import { adminSessoes, carregarPecaDoTenant, carregarSessao } from '@/lib/ia/sessao/sessoes'

// Uma rodada de lapidação com dossiê grande leva o mesmo tempo de uma geração
// (150–275s medidos). Teto menor cortaria a resposta no meio.
export const maxDuration = 300

const schema = z.object({
  instrucao: z.string().trim().min(1, 'A instrução é obrigatória').max(20_000),
})

// POST /api/pecas/[id]/sessao/[sid]/mensagem — UMA rodada da sessão (SSE).
//
// O handler é fino de propósito: valida, autoriza e delega. Toda a lógica —
// contexto, cache, structured output, verificação de citações, custo — vive em
// src/lib/ia/sessao/ (regra da casa: nada de export extra em route.ts).
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; sid: string }> },
) {
  const { id: pecaId, sid } = await params

  try {
    const auth = await getAuthContext()
    if (!auth.ok) return auth.response
    const { supabase, usuario } = auth

    const parsed = await validateBody(req, schema)
    if (!parsed.ok) return parsed.response

    const cota = await verificarCota(supabase, usuario.tenant_id, ENDPOINT_SESSAO)
    if (!cota.permitido) return jsonError(mensagemCotaExcedida(cota), 429)

    const peca = await carregarPecaDoTenant(supabase, pecaId, usuario.tenant_id)
    if (!peca) return jsonError('Peça não encontrada', 404)

    const admin = adminSessoes()
    const sessao = await carregarSessao(admin, { sessaoId: sid, pecaId, tenantId: usuario.tenant_id })
    if (!sessao) return jsonError('Sessão não encontrada', 404)

    if (sessao.status !== 'ativa') {
      return jsonError(`Esta sessão está ${sessao.status} e não aceita novas rodadas.`, 409, {
        code: 'SESSAO_NAO_ATIVA',
        status: sessao.status,
      })
    }

    if (!(peca.conteudo_markdown ?? '').trim()) {
      return jsonError('A peça ainda não tem conteúdo para lapidar', 400)
    }

    return await executarRodada({
      supabase,
      admin,
      tenantId: usuario.tenant_id,
      usuarioId: usuario.id,
      peca,
      sessao,
      instrucao: parsed.data.instrucao,
    })
  } catch (err) {
    // LGPD: só ids no log — nunca a instrução ou o texto da peça.
    logger.error('ia.sessao.mensagem.falha', { pecaId, sessaoId: sid }, err)
    const status = (err as { status?: number })?.status
    const message = err instanceof Error ? err.message : 'Erro desconhecido'
    return jsonError(message, typeof status === 'number' ? status : 500)
  }
}
