import { NextRequest } from 'next/server'
import { getAuthContext } from '@/lib/auth'
import { jsonError } from '@/lib/api'
import { streamCompletion, DEFAULT_MODEL } from '@/lib/anthropic/client'
import { montarPromptDoModo, respostaStreamPeca, logUsagePosStream } from '@/lib/ia/pecas/motor'
import { verificarCota, mensagemCotaExcedida } from '@/lib/anthropic/quota'

export const maxDuration = 300 // geração/reescrita de peça pode levar 150-275s; teto baixo cortava a saída

// POST /api/ia/correcao-auto — aplicar correção automática.
//
// Adaptador do modo 'corrigir' do motor único (F0.2): o system e as três
// instruções de correção foram MOVIDOS, byte a byte, para
// src/lib/prompts/pecas/_shared/modo-corrigir.ts (travados por snapshot).
export async function POST(req: NextRequest) {
  const start = Date.now()

  try {
    const { pecaId, tipo } = await req.json()
    if (!pecaId || !tipo) {
      return jsonError('pecaId e tipo são obrigatórios', 400)
    }

    const auth = await getAuthContext()
    if (!auth.ok) return auth.response
    const { supabase, usuario } = auth

    const cota = await verificarCota(supabase, usuario.tenant_id, 'correcao')
    if (!cota.permitido) return jsonError(mensagemCotaExcedida(cota), 429)

    const { data: peca } = await supabase
      .from('pecas')
      .select('*')
      .eq('id', pecaId)
      .eq('tenant_id', usuario.tenant_id)
      .single()
    if (!peca) return jsonError('Peça não encontrada', 404)

    // A correção olha só a peça — não precisa do contexto do caso (ctx null).
    const { system, prompt } = montarPromptDoModo('corrigir', null, {
      pecaAtual: peca.conteudo_markdown ?? '',
      tipoCorrecao: tipo,
    })

    // maxTokens alto: a correção reescreve a peça COMPLETA (o default 8192
    // truncaria peças longas). O versionamento fica a cargo do salvar-peca que
    // o cliente chama ao persistir o resultado (evita versionar em dobro).
    const { stream, getUsage } = await streamCompletion({ system, prompt, maxTokens: 32768 })

    // Log assíncrono
    logUsagePosStream({ getUsage, tenantId: usuario.tenant_id, userId: usuario.id, endpoint: `correcao_${tipo}`, modelo: DEFAULT_MODEL, start })

    return respostaStreamPeca(stream)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Erro desconhecido'
    return jsonError(message, 500)
  }
}
