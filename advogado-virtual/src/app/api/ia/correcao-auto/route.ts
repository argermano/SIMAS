import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { streamCompletion, DEFAULT_MODEL } from '@/lib/anthropic/client'
import { logUsage } from '@/lib/anthropic/usage'

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
      return NextResponse.json({ error: 'pecaId e tipo são obrigatórios' }, { status: 400 })
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

    const { data: peca } = await supabase
      .from('pecas')
      .select('*')
      .eq('id', pecaId)
      .eq('tenant_id', usuario.tenant_id)
      .single()
    if (!peca) return NextResponse.json({ error: 'Peça não encontrada' }, { status: 404 })

    const prompt = buildPromptCorrecao(peca.conteudo_markdown ?? '', tipo)

    const { stream, getUsage } = await streamCompletion({ system: SYSTEM, prompt })

    // Salvar versão antiga
    await supabase.from('pecas_versoes').insert({
      peca_id: pecaId,
      versao: peca.versao,
      conteudo_markdown: peca.conteudo_markdown,
      alterado_por: usuario.id,
    })

    // Incrementar versão
    await supabase.from('pecas').update({ versao: peca.versao + 1 }).eq('id', pecaId)

    // Log assíncrono
    getUsage().then(async (usage) => {
      await logUsage({
        tenantId: usuario.tenant_id,
        userId: usuario.id,
        endpoint: `correcao_${tipo}`,
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
