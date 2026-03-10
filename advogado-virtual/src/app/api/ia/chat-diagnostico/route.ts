import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { streamCompletion, DEFAULT_MODEL } from '@/lib/anthropic/client'
import { logUsage } from '@/lib/anthropic/usage'

const SYSTEM_CHAT_DIAGNOSTICO = `Você é um consultor jurídico experiente ajudando um advogado a entender e aprofundar a análise diagnóstica de um caso.

CONTEXTO: O advogado já recebeu um diagnóstico automatizado (análise de caso) e agora quer tirar dúvidas, explorar estratégias ou refinar o entendimento antes de gerar a peça processual.

REGRAS:
- Responda de forma clara, objetiva e prática
- Fundamente suas respostas em legislação e jurisprudência quando relevante
- Se o advogado perguntar sobre estratégia processual, apresente prós e contras
- Se perguntarem sobre prazos, cite os prazos legais aplicáveis
- Sempre considere o contexto do caso (transcrição + diagnóstico) na resposta
- Seja direto — o advogado já tem conhecimento jurídico
- Use linguagem técnica jurídica quando apropriado
- Se não tiver certeza, diga que é necessário verificar a legislação específica
- Respostas em português do Brasil`

// POST /api/ia/chat-diagnostico — chat sobre o diagnóstico com streaming
export async function POST(req: NextRequest) {
  const start = Date.now()

  try {
    const body = await req.json()
    const { mensagem, historico, diagnostico, transcricao, pedidoEspecifico } = body as {
      mensagem: string
      historico?: Array<{ role: 'user' | 'assistant'; content: string }>
      diagnostico: Record<string, unknown>
      transcricao: string
      pedidoEspecifico?: string
    }

    if (!mensagem?.trim()) {
      return NextResponse.json({ error: 'Mensagem é obrigatória' }, { status: 400 })
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

    // Construir prompt com contexto completo
    const partes: string[] = []

    partes.push('## CASO DO CLIENTE (transcrição/relato)')
    partes.push(transcricao)

    if (pedidoEspecifico) {
      partes.push('\n## QUESTÃO ESPECÍFICA DO ADVOGADO')
      partes.push(pedidoEspecifico)
    }

    partes.push('\n## DIAGNÓSTICO DA IA')
    partes.push(JSON.stringify(diagnostico, null, 2))

    if (historico && historico.length > 0) {
      partes.push('\n## CONVERSA ANTERIOR')
      for (const msg of historico) {
        partes.push(`${msg.role === 'user' ? 'ADVOGADO' : 'CONSULTOR'}: ${msg.content}`)
      }
    }

    partes.push('\n## NOVA PERGUNTA DO ADVOGADO')
    partes.push(mensagem)

    partes.push('\nResponda de forma clara e prática. Se a pergunta for sobre estratégia, apresente opções com prós e contras.')

    const prompt = partes.join('\n')

    const { stream, getUsage } = await streamCompletion({
      system: SYSTEM_CHAT_DIAGNOSTICO,
      prompt,
      maxTokens: 4096,
    })

    // Log assíncrono
    getUsage().then(async (usage) => {
      await logUsage({
        tenantId: usuario.tenant_id,
        userId: usuario.id,
        endpoint: 'chat_diagnostico',
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
    console.error('[chat-diagnostico] Erro:', message, err)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
