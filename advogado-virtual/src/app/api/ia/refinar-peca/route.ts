import { NextRequest } from 'next/server'
import { getAuthContext } from '@/lib/auth'
import { jsonError } from '@/lib/api'
import { streamCompletion } from '@/lib/anthropic/client'
import { modeloDaVersao, normalizarVersao } from '@/lib/anthropic/versoes'
import { verificarCota, mensagemCotaExcedida } from '@/lib/anthropic/quota'
import { montarContextoPeca } from '@/lib/ia/pecas/contexto'
import {
  montarPromptDoModo,
  respostaStreamPeca,
  logUsagePosStream,
  salvarPecaPosStreamSeVazia,
  salvarVersaoAnterior,
} from '@/lib/ia/pecas/motor'
import { logger } from '@/lib/logger'

export const maxDuration = 300 // geração/reescrita de peça pode levar 150-275s; teto baixo cortava a saída

// POST /api/ia/refinar-peca — rodada de refino de uma peça EXISTENTE.
//
// Diferença essencial para /api/ia/refinamento-peca: aquele cria uma peça nova
// (porta de entrada de peça de fora); ESTE mantém a MESMA peça e VERSIONA — o
// conteúdo atual vai para pecas_versoes com origem='refino' e a `instrucao` que
// motivou a rodada (colunas da migration 085), e a peça recebe o texto refinado.
//
// Quem grava o texto novo é o cliente (POST /api/ia/salvar-peca, com a guarda
// anti-encolhimento da camada C). A rede de segurança pós-stream cobre apenas o
// ABANDONO (aba fechada no meio): ela só escreve se o conteúdo no banco ainda
// for exatamente o de antes do stream.
//
// Body: { pecaId, instrucao, versao? }  → SSE (mesmo formato da geração).
export async function POST(req: NextRequest) {
  const start = Date.now()

  try {
    const { pecaId, instrucao, versao } = await req.json() as {
      pecaId?: string
      instrucao?: string
      versao?: string
    }

    if (!pecaId || !instrucao?.trim()) {
      return jsonError('pecaId e instrucao são obrigatórios', 400)
    }

    // Padrão x Raciocínio estendido (mesma escolha da geração).
    const versaoIA = normalizarVersao(versao)
    const modelo = modeloDaVersao(versao)

    const auth = await getAuthContext()
    if (!auth.ok) return auth.response
    const { supabase, usuario } = auth

    const cota = await verificarCota(supabase, usuario.tenant_id, 'refinar_peca')
    if (!cota.permitido) return jsonError(mensagemCotaExcedida(cota), 429)

    const { data: peca } = await supabase
      .from('pecas')
      .select('id, atendimento_id, area, tipo, versao, conteudo_markdown')
      .eq('id', pecaId)
      .eq('tenant_id', usuario.tenant_id)
      .single()
    if (!peca) return jsonError('Peça não encontrada', 404)

    const conteudoAtual = (peca.conteudo_markdown as string | null) ?? ''
    if (!conteudoAtual.trim()) {
      return jsonError('A peça ainda não tem conteúdo para refinar', 400)
    }

    const ctx = await montarContextoPeca({
      supabase,
      tenantId: usuario.tenant_id,
      atendimentoId: peca.atendimento_id,
      area: peca.area,
      tipo: peca.tipo,
      escopo: 'enxuto',
    })
    if (!ctx) return jsonError('Atendimento da peça não encontrado', 404)

    const { system, prompt } = montarPromptDoModo('refinar', ctx, {
      pecaAtual: conteudoAtual,
      instrucao,
    })

    // Versiona ANTES de qualquer escrita: o texto que está no ar hoje vira
    // histórico com a origem e a instrução desta rodada. (salvar-peca não
    // duplica esta linha — ele pula o arquivamento quando a versão já existe.)
    const versaoAnterior = (peca.versao as number | null) ?? 1
    await salvarVersaoAnterior(supabase, {
      pecaId,
      versao: versaoAnterior,
      conteudoMarkdown: conteudoAtual,
      usuarioId: usuario.id,
      origem: 'refino',
      instrucao: instrucao.trim(),
    })

    const { stream, getUsage, getFinal } = await streamCompletion({
      system,
      prompt,
      maxTokens: 32768,
      model: modelo,
      versao: versaoIA,
    })

    logUsagePosStream({ getUsage, tenantId: usuario.tenant_id, userId: usuario.id, endpoint: 'refinar_peca', modelo, start })

    // Rede de segurança: SÓ para abandono — não sobrescreve o que o cliente salvar.
    salvarPecaPosStreamSeVazia({
      getFinal,
      pecaId,
      atendimentoId: peca.atendimento_id,
      refino: { conteudoAnterior: conteudoAtual, versaoAnterior },
    })

    // LGPD: só ids e contagens — nunca a instrução ou o texto da peça.
    logger.info('ia.refinar_peca.iniciado', {
      pecaId,
      versaoAnterior,
      documentos: ctx.meta.documentosRelevantes,
    })

    return respostaStreamPeca(stream, pecaId)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Erro desconhecido'
    logger.error('ia.refinar_peca.falha', {}, err)
    return jsonError(message, 500)
  }
}
