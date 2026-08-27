import { NextRequest } from 'next/server'
import { getAuthContext } from '@/lib/auth'
import { jsonError } from '@/lib/api'
import { streamCompletion, DEFAULT_MODEL } from '@/lib/anthropic/client'
import { montarContextoPeca } from '@/lib/ia/pecas/contexto'
import {
  statusInicialPeca,
  montarPromptDoModo,
  respostaStreamPeca,
  logUsagePosStream,
  salvarPecaPosStreamSeVazia,
} from '@/lib/ia/pecas/motor'
import { verificarCota, mensagemCotaExcedida } from '@/lib/anthropic/quota'
import { logger } from '@/lib/logger'

export const maxDuration = 300 // geração/reescrita de peça pode levar 150-275s; teto baixo cortava a saída

// POST /api/ia/refinamento-peca — porta de entrada de peça VINDA DE FORA: o
// advogado cola/sobe uma peça pronta e a IA a refina com os documentos do caso.
// Cria a peça v1 no SIMAS (é o nascimento dela aqui dentro) — diferente de
// /api/ia/refinar-peca, que refina uma peça JÁ existente e a versiona.
//
// Usa o modo 'refinar' do motor único (F0.2): mesmo system e mesma montagem de
// prompt, agora com a triagem de relevância dos documentos e o teto por
// documento (MAX_CHARS_POR_DOC) — antes ia o texto integral de todos os
// documentos, o principal candidato a estourar o limite de prompt (413).
export async function POST(req: NextRequest) {
  const start = Date.now()

  try {
    const body = await req.json()
    const { atendimentoId, area, pecaOriginal, instrucoes } = body as {
      atendimentoId: string
      area: string
      pecaOriginal: string
      instrucoes?: string
    }

    if (!atendimentoId || !area || !pecaOriginal) {
      return jsonError('atendimentoId, area e pecaOriginal são obrigatórios', 400)
    }

    const auth = await getAuthContext()
    if (!auth.ok) return auth.response
    const { supabase, usuario } = auth

    // Conta na cota de refino (antes não verificava e logava como "Outros").
    const cota = await verificarCota(supabase, usuario.tenant_id, 'refinar_peca')
    if (!cota.permitido) return jsonError(mensagemCotaExcedida(cota), 429)

    const statusInicial = statusInicialPeca(usuario.role)

    // Contexto enxuto: documentos triados + qualificação. Sem jurisprudência e
    // sem modelo padrão — a estrutura aqui é a da peça que o advogado trouxe.
    const ctx = await montarContextoPeca({
      supabase,
      tenantId: usuario.tenant_id,
      atendimentoId,
      area,
      tipo: 'refinamento',
      escopo: 'enxuto',
    })
    if (!ctx) return jsonError('Atendimento não encontrado', 404)

    const { system, prompt } = montarPromptDoModo('refinar', ctx, {
      pecaAtual: pecaOriginal,
      instrucao: instrucoes,
    })

    // Criar peça no banco
    const { data: peca } = await supabase
      .from('pecas')
      .insert({
        atendimento_id: atendimentoId,
        tenant_id: usuario.tenant_id,
        tipo: 'refinamento',
        area,
        status: statusInicial,
        created_by: usuario.id,
      })
      .select('id')
      .single()

    const { stream, getUsage, getFinal } = await streamCompletion({
      system,
      prompt,
      maxTokens: 32768,
    })

    // Log assíncrono
    logUsagePosStream({ getUsage, tenantId: usuario.tenant_id, userId: usuario.id, endpoint: 'refinar_peca', modelo: DEFAULT_MODEL, start })
    // Rede de segurança: salva no servidor se o cliente não salvar.
    if (peca?.id) salvarPecaPosStreamSeVazia({ getFinal, pecaId: peca.id, atendimentoId })

    return respostaStreamPeca(stream, peca?.id ?? '')
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Erro desconhecido'
    logger.error('ia.refinamento_peca.falha', {}, err)
    return jsonError(message, 500)
  }
}
