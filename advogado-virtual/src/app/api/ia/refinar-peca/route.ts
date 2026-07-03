import { NextRequest, NextResponse } from 'next/server'
import { completionJSON, DEFAULT_MODEL } from '@/lib/anthropic/client'
import { logUsage } from '@/lib/anthropic/usage'
import { verificarCota, mensagemCotaExcedida } from '@/lib/anthropic/quota'
import { buildPromptRefinar, SYSTEM_REFINAR } from '@/lib/prompts/refinamento/refinar-com-documentos'
import { salvarVersaoAnterior } from '@/lib/ia/pecas/motor'
import { getAuthContext } from '@/lib/auth'
import { jsonError } from '@/lib/api'

export const maxDuration = 300 // geração/reescrita de peça pode levar 150-275s; teto baixo cortava a saída

// POST /api/ia/refinar-peca — refinar peça com novos documentos
export async function POST(req: NextRequest) {
  const start = Date.now()

  try {
    const { pecaId } = await req.json()
    if (!pecaId) return jsonError('pecaId é obrigatório', 400)

    const auth = await getAuthContext()
    if (!auth.ok) return auth.response
    const { supabase, usuario } = auth

    const cota = await verificarCota(supabase, usuario.tenant_id, 'refinar_peca')
    if (!cota.permitido) return jsonError(mensagemCotaExcedida(cota), 429)

    // Buscar peça
    const { data: peca } = await supabase
      .from('pecas')
      .select('*')
      .eq('id', pecaId)
      .eq('tenant_id', usuario.tenant_id)
      .single()
    if (!peca) return jsonError('Peça não encontrada', 404)

    // Buscar documentos do atendimento
    const { data: documentos } = await supabase
      .from('documentos')
      .select('tipo, texto_extraido, file_name')
      .eq('atendimento_id', peca.atendimento_id)

    if (!documentos || documentos.length === 0) {
      return jsonError('Nenhum documento encontrado para refinar', 400)
    }

    const prompt = buildPromptRefinar({
      peca_atual: peca.conteudo_markdown ?? '',
      documentos_novos: documentos.map(d => ({
        tipo: d.tipo ?? 'outro',
        texto_extraido: d.texto_extraido ?? '',
        file_name: d.file_name ?? 'documento',
      })),
    })

    const { result, usage } = await completionJSON<{
      peca_refinada: string
      mudancas: Array<{ tipo: string; descricao: string; documento_fonte: string }>
      divergencias: Array<{ fato_transcricao: string; fato_documento: string; recomendacao: string }>
    }>({ system: SYSTEM_REFINAR, prompt })

    // Salvar versão antiga
    await salvarVersaoAnterior(supabase, { pecaId, versao: peca.versao, conteudoMarkdown: peca.conteudo_markdown, usuarioId: usuario.id })

    // Atualizar peça
    await supabase
      .from('pecas')
      .update({
        conteudo_markdown: result.peca_refinada,
        versao: peca.versao + 1,
      })
      .eq('id', pecaId)

    // Log
    await logUsage({
      tenantId: usuario.tenant_id,
      userId: usuario.id,
      endpoint: 'refinar_peca',
      modelo: DEFAULT_MODEL,
      tokensInput: usage.input,
      tokensOutput: usage.output,
      latenciaMs: Date.now() - start,
    })

    return NextResponse.json({
      versao: peca.versao + 1,
      mudancas: result.mudancas,
      divergencias: result.divergencias,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Erro desconhecido'
    return jsonError(message, 500)
  }
}
