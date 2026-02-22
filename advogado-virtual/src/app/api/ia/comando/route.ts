import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { streamCompletion, DEFAULT_MODEL } from '@/lib/anthropic/client'
import { logUsage } from '@/lib/anthropic/usage'
import { PROMPTS_COMANDOS } from '@/lib/prompts/comandos'

// POST /api/ia/comando — executar comando rápido
export async function POST(req: NextRequest) {
  const start = Date.now()

  try {
    const { atendimentoId, comandoId } = await req.json()

    if (!atendimentoId || !comandoId) {
      return NextResponse.json({ error: 'atendimentoId e comandoId são obrigatórios' }, { status: 400 })
    }

    const comandoConfig = PROMPTS_COMANDOS[comandoId]
    if (!comandoConfig) {
      return NextResponse.json({ error: `Comando "${comandoId}" não encontrado` }, { status: 400 })
    }

    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })

    const { data: usuario } = await supabase
      .from('users')
      .select('id, tenant_id')
      .eq('auth_user_id', user.id)
      .single()
    if (!usuario) return NextResponse.json({ error: 'Usuário não encontrado' }, { status: 404 })

    const { data: atendimento } = await supabase
      .from('atendimentos')
      .select('transcricao_editada, transcricao_raw, pedidos_especificos, tenant_id')
      .eq('id', atendimentoId)
      .eq('tenant_id', usuario.tenant_id)
      .single()
    if (!atendimento) return NextResponse.json({ error: 'Atendimento não encontrado' }, { status: 404 })

    const transcricao = atendimento.transcricao_editada ?? atendimento.transcricao_raw ?? ''
    if (!transcricao.trim()) {
      return NextResponse.json({ error: 'Sem transcrição disponível' }, { status: 400 })
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
    }).catch(() => {})

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      },
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Erro desconhecido'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
