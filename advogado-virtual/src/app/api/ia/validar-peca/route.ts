import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { completionJSON, DEFAULT_MODEL } from '@/lib/anthropic/client'
import { logUsage } from '@/lib/anthropic/usage'
import { buildPromptRevisarValidar, SYSTEM_VALIDAR } from '@/lib/prompts/validacao/revisar-validar'

// POST /api/ia/validar-peca — revisar e validar peça
export async function POST(req: NextRequest) {
  const start = Date.now()

  try {
    const { pecaId } = await req.json()
    if (!pecaId) return NextResponse.json({ error: 'pecaId é obrigatório' }, { status: 400 })

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
    if (!peca.conteudo_markdown) return NextResponse.json({ error: 'Peça sem conteúdo' }, { status: 400 })

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

    return NextResponse.json(result)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Erro desconhecido'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
