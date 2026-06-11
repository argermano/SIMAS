import { NextRequest } from 'next/server'
import { streamCompletion, DEFAULT_MODEL } from '@/lib/anthropic/client'
import { logUsage } from '@/lib/anthropic/usage'
import { verificarCota, mensagemCotaExcedida } from '@/lib/anthropic/quota'
import { PROMPTS_COMANDOS } from '@/lib/prompts/comandos'
import { getAuthContext } from '@/lib/auth'
import { jsonError } from '@/lib/api'

// POST /api/ia/comando — executar comando rápido
export async function POST(req: NextRequest) {
  const start = Date.now()

  try {
    const { atendimentoId, comandoId } = await req.json()

    if (!atendimentoId || !comandoId) {
      return jsonError('atendimentoId e comandoId são obrigatórios', 400)
    }

    const comandoConfig = PROMPTS_COMANDOS[comandoId]
    if (!comandoConfig) {
      return jsonError(`Comando "${comandoId}" não encontrado`, 400)
    }

    const auth = await getAuthContext()
    if (!auth.ok) return auth.response
    const { supabase, usuario } = auth

    const cota = await verificarCota(supabase, usuario.tenant_id, 'comando')
    if (!cota.permitido) return jsonError(mensagemCotaExcedida(cota), 429)

    const { data: atendimento } = await supabase
      .from('atendimentos')
      .select('transcricao_editada, transcricao_raw, pedidos_especificos, tenant_id')
      .eq('id', atendimentoId)
      .eq('tenant_id', usuario.tenant_id)
      .single()
    if (!atendimento) return jsonError('Atendimento não encontrado', 404)

    const transcricao = atendimento.transcricao_editada ?? atendimento.transcricao_raw ?? ''
    if (!transcricao.trim()) {
      return jsonError('Sem transcrição disponível', 400)
    }

    const prompt = comandoConfig.buildPrompt(transcricao, atendimento.pedidos_especificos ?? undefined)

    const { stream, getUsage } = await streamCompletion({
      system: comandoConfig.system,
      prompt,
    })

    // Log assíncrono
    getUsage().then(async (usage) => {
      await logUsage({
        tenantId: usuario.tenant_id,
        userId: usuario.id,
        endpoint: `comando_${comandoId}`,
        modelo: DEFAULT_MODEL,
        tokensInput: usage.input,
        tokensOutput: usage.output,
        latenciaMs: Date.now() - start,
      })
    }).catch((e) => console.error('[logUsage] erro pós-stream (comando):', e))

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      },
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Erro desconhecido'
    return jsonError(message, 500)
  }
}
