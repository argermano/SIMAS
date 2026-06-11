import { NextRequest, NextResponse } from 'next/server'
import { getAuthContext } from '@/lib/auth'
import { jsonError } from '@/lib/api'
import { completionJSON, DEFAULT_MODEL } from '@/lib/anthropic/client'
import { logUsage } from '@/lib/anthropic/usage'
import { verificarCota, mensagemCotaExcedida } from '@/lib/anthropic/quota'
import { buildPromptRevisarValidar, SYSTEM_VALIDAR } from '@/lib/prompts/validacao/revisar-validar'
import { validarFormatacaoPeca } from '@/lib/format/validar-peca'

// POST /api/ia/validar-peca — revisar e validar peça
export async function POST(req: NextRequest) {
  const start = Date.now()

  try {
    const { pecaId } = await req.json()
    if (!pecaId) return jsonError('pecaId é obrigatório', 400)

    const auth = await getAuthContext()
    if (!auth.ok) return auth.response
    const { supabase, usuario } = auth

    const cota = await verificarCota(supabase, usuario.tenant_id, 'validar_peca')
    if (!cota.permitido) return jsonError(mensagemCotaExcedida(cota), 429)

    const { data: peca } = await supabase
      .from('pecas')
      .select('*')
      .eq('id', pecaId)
      .eq('tenant_id', usuario.tenant_id)
      .single()
    if (!peca) return jsonError('Peça não encontrada', 404)
    if (!peca.conteudo_markdown) return jsonError('Peça sem conteúdo', 400)

    const prompt = buildPromptRevisarValidar({
      peca: peca.conteudo_markdown,
      area: peca.area,
      tipo_peca: peca.tipo,
    })

    const { result, usage } = await completionJSON<Record<string, unknown>>({
      system: SYSTEM_VALIDAR,
      prompt,
    })

    // Salvar validação na peça
    await supabase
      .from('pecas')
      .update({
        validacao_coerencia: result.coerencia ?? null,
        validacao_fontes: {
          legislacao: result.legislacao,
          jurisprudencia: result.jurisprudencia,
          doutrina: result.doutrina,
          score: result.score_confianca,
          correcoes: result.correcoes_sugeridas,
        },
        status: 'revisada',
      })
      .eq('id', pecaId)

    // Log
    await logUsage({
      tenantId: usuario.tenant_id,
      userId: usuario.id,
      endpoint: 'validar_peca',
      modelo: DEFAULT_MODEL,
      tokensInput: usage.input,
      tokensOutput: usage.output,
      latenciaMs: Date.now() - start,
    })

    // Validação determinística de formatação (complementa a validação por IA)
    const formatacao = validarFormatacaoPeca(peca.conteudo_markdown)

    return NextResponse.json({ ...result, formatacao })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Erro desconhecido'
    return jsonError(message, 500)
  }
}
