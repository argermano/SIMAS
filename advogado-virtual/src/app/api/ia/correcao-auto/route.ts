import { NextRequest } from 'next/server'
import { getAuthContext } from '@/lib/auth'
import { jsonError } from '@/lib/api'
import { streamCompletion, DEFAULT_MODEL } from '@/lib/anthropic/client'
import { respostaStreamPeca, logUsagePosStream } from '@/lib/ia/pecas/motor'
import { verificarCota, mensagemCotaExcedida } from '@/lib/anthropic/quota'

export const maxDuration = 120

const SYSTEM = `Você é um advogado revisor. Aplique a correção solicitada à peça e retorne a peça completa corrigida em Markdown. Não adicione explicações, apenas a peça corrigida.`

function buildPromptCorrecao(peca: string, tipo: string): string {
  const instrucoes: Record<string, string> = {
    remover_citacao: 'Remova TODAS as citações de jurisprudência que parecem inventadas ou não verificáveis. Substitua por fundamentos legais sólidos (legislação e doutrina reconhecida).',
    completar_item: 'Identifique e complete TODOS os campos marcados com [PREENCHER] com textos modelo/placeholder realistas. Adicione itens obrigatórios da peça que estejam faltando (valor da causa, justiça gratuita, provas, etc.).',
    ajustar_pedido: 'Revise os pedidos para garantir coerência com os fatos e fundamentos. Ajuste valores, corrija inconsistências e garanta que todos os pedidos estejam fundamentados.',
  }

  return `
## PEÇA ATUAL
${peca}

## CORREÇÃO SOLICITADA
${instrucoes[tipo] ?? 'Revise e corrija a peça, melhorando a qualidade geral.'}

Responda APENAS com a peça corrigida em Markdown. Sem explicações adicionais.
`.trim()
}

// POST /api/ia/correcao-auto — aplicar correção automática
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

    const prompt = buildPromptCorrecao(peca.conteudo_markdown ?? '', tipo)

    // maxTokens alto: a correção reescreve a peça COMPLETA (o default 8192
    // truncaria peças longas). O versionamento fica a cargo do salvar-peca que
    // o cliente chama ao persistir o resultado (evita versionar em dobro).
    const { stream, getUsage } = await streamCompletion({ system: SYSTEM, prompt, maxTokens: 32768 })

    // Log assíncrono
    logUsagePosStream({ getUsage, tenantId: usuario.tenant_id, userId: usuario.id, endpoint: `correcao_${tipo}`, modelo: DEFAULT_MODEL, start })

    return respostaStreamPeca(stream)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Erro desconhecido'
    return jsonError(message, 500)
  }
}
