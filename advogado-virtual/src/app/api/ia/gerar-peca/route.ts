import { NextRequest } from 'next/server'
import { getAuthContext } from '@/lib/auth'
import { jsonError } from '@/lib/api'
import { streamCompletion } from '@/lib/anthropic/client'
import { modeloDaVersao, normalizarVersao } from '@/lib/anthropic/versoes'
import { verificarCota, mensagemCotaExcedida } from '@/lib/anthropic/quota'
import type { ResultadoJurisprudencia } from '@/lib/jurisprudencia/datajud'
import type { QualificacaoPartes } from '@/lib/ia/pecas/registro-pecas'
import { montarContextoPeca } from '@/lib/ia/pecas/contexto'
import {
  statusInicialPeca,
  montarPromptDoModo,
  respostaStreamPeca,
  logUsagePosStream,
  salvarPecaPosStreamSeVazia,
} from '@/lib/ia/pecas/motor'
import { logger } from '@/lib/logger'

// SEM maxDuration: a geração de peça longa leva 150–275s (medido). Um teto
// (ex.: 120) MATA a função no meio e a peça sai truncada — foi exatamente o que
// aconteceu. Sem teto, o stream roda até o fim, como sempre funcionou. Só
// migrar isto para fila/etapas (B4) se algum dia bater no limite máximo do plano.
export const maxDuration = 300

// POST /api/ia/gerar-peca — gerar peça com streaming SSE.
//
// ADAPTADOR FINO do modo 'criar' do motor único (F0.2): toda a montagem do
// contexto (atendimento, documentos + triagem de relevância, qualificação,
// jurisprudência, modelo padrão, prompt curado/genérico e fundamentação
// verificada) vive em src/lib/ia/pecas/contexto.ts, e a composição do prompt em
// montarPromptDoModo. O texto enviado ao modelo é o MESMO byte a byte.
export async function POST(req: NextRequest) {
  const start = Date.now()

  try {
    const { atendimentoId, analiseId, tipo, area, jurisprudencia, tribunais, qualificacao, versao } = await req.json() as {
      atendimentoId: string
      analiseId?: string
      tipo: string
      area: string
      jurisprudencia?: ResultadoJurisprudencia[]
      tribunais?: string[]
      qualificacao?: QualificacaoPartes
      versao?: string
    }

    if (!atendimentoId || !tipo || !area) {
      return jsonError('atendimentoId, tipo e area são obrigatórios', 400)
    }

    // Versão escolhida pelo usuário (Padrão x Raciocínio estendido) → modelo.
    // A versão também vai ao client: 'avancado' liga raciocínio adaptativo +
    // esforço alto (o modo padrão segue exatamente como antes).
    const versaoIA = normalizarVersao(versao)
    const modelo = modeloDaVersao(versao)

    const auth = await getAuthContext()
    if (!auth.ok) return auth.response
    const { supabase, usuario } = auth

    const cota = await verificarCota(supabase, usuario.tenant_id, 'gerar_peca')
    if (!cota.permitido) return jsonError(mensagemCotaExcedida(cota), 429)

    // Colaboradores não podem publicar diretamente — peça vai para fila de revisão
    const statusInicial = statusInicialPeca(usuario.role)

    const ctx = await montarContextoPeca({
      supabase,
      tenantId: usuario.tenant_id,
      atendimentoId,
      area,
      tipo,
      analiseId,
      jurisprudencia,
      tribunais,
      qualificacao,
    })
    if (!ctx) return jsonError('Atendimento não encontrado', 404)

    const { system, prompt } = montarPromptDoModo('criar', ctx)

    // Criar peça no banco (status rascunho) ANTES do stream → X-Peca-Id sempre válido
    const { data: peca, error: pecaError } = await supabase
      .from('pecas')
      .insert({
        atendimento_id: atendimentoId,
        analise_id: analiseId ?? null,
        tenant_id: usuario.tenant_id,
        tipo,
        area,
        // Só o caminho curado gravava o trecho do prompt; mantido como estava
        // para o comportamento continuar idêntico ao de antes da extração.
        ...(ctx.meta.curado ? { prompt_utilizado: prompt.substring(0, 500) } : {}),
        modelo_ia: modelo,
        status: statusInicial,
        created_by: usuario.id,
      })
      .select('id')
      .single()

    if (pecaError || !peca) {
      console.error('[gerar-peca] erro ao criar peça:', pecaError?.message)
      return jsonError('Erro ao criar registro da peça', 500)
    }

    const { stream, getUsage, getFinal } = await streamCompletion({
      system,
      prompt,
      maxTokens: 32768,
      model: modelo,
      versao: versaoIA,
    })

    // Log assíncrono (não bloqueia o stream)
    logUsagePosStream({ getUsage, tenantId: usuario.tenant_id, userId: usuario.id, endpoint: 'gerar_peca', modelo, start })
    // Rede de segurança: salva no servidor se o cliente não salvar (aba fechada no meio do stream).
    salvarPecaPosStreamSeVazia({ getFinal, pecaId: peca.id, atendimentoId })

    return respostaStreamPeca(stream, peca.id)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Erro desconhecido'
    logger.error('ia.gerar_peca.falha', {}, err)
    return jsonError(message, 500)
  }
}
