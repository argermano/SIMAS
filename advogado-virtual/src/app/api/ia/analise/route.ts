import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { completionJSON, DEFAULT_MODEL } from '@/lib/anthropic/client'
import { logUsage } from '@/lib/anthropic/usage'
import { buildPromptAnalisePrev, SYSTEM_ANALISE_PREV } from '@/lib/prompts/analise/previdenciario'
import { buildPromptAnaliseTrab, SYSTEM_ANALISE_TRAB } from '@/lib/prompts/analise/trabalhista'

// POST /api/ia/analise — gerar análise jurídica
export async function POST(req: NextRequest) {
  const start = Date.now()

  try {
    const { atendimentoId } = await req.json()
    if (!atendimentoId) {
      return NextResponse.json({ error: 'atendimentoId é obrigatório' }, { status: 400 })
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

    // Buscar atendimento com documentos
    const { data: atendimento } = await supabase
      .from('atendimentos')
      .select('*, documentos(*)')
      .eq('id', atendimentoId)
      .eq('tenant_id', usuario.tenant_id)
      .single()

    if (!atendimento) return NextResponse.json({ error: 'Atendimento não encontrado' }, { status: 404 })

    const transcricao = atendimento.transcricao_editada ?? atendimento.transcricao_raw ?? ''
    if (!transcricao.trim()) {
      return NextResponse.json({ error: 'Atendimento sem transcrição ou texto' }, { status: 400 })
    }

    const documentos = (atendimento.documentos ?? []).map((d: Record<string, unknown>) => ({
      tipo: d.tipo as string,
      texto_extraido: (d.texto_extraido as string) ?? '',
      file_name: d.file_name as string,
    }))

    // Selecionar prompt por área
    let system: string
    let prompt: string

    if (atendimento.area === 'trabalhista') {
      system = SYSTEM_ANALISE_TRAB
      prompt = buildPromptAnaliseTrab({
        transcricao,
        pedido_especifico: atendimento.pedidos_especificos,
        documentos,
        tipo_peca_origem: atendimento.tipo_peca_origem,
      })
    } else {
      system = SYSTEM_ANALISE_PREV
      prompt = buildPromptAnalisePrev({
        transcricao,
        pedido_especifico: atendimento.pedidos_especificos,
        documentos,
        tipo_peca_origem: atendimento.tipo_peca_origem,
      })
    }

    // Chamar Claude (JSON mode)
    const { result, usage } = await completionJSON<Record<string, unknown>>({ system, prompt })

    // Salvar análise no banco
    const { data: analise, error: errAnalise } = await supabase
      .from('analises')
      .insert({
        atendimento_id: atendimentoId,
        tenant_id: usuario.tenant_id,
        resumo_fatos: (result.resumo_didatico as string) ?? null,
        tese_principal: (result.caminho_processual as Record<string, unknown>)?.recomendado as string ?? null,
        plano_a: result.plano_a ?? null,
        plano_b: result.plano_b ?? null,
        riscos: result.riscos ?? null,
        checklist_documentos: result.checklist_documentos ?? null,
        perguntas_faltantes: result.perguntas_faltantes ?? null,
        acoes_sugeridas: result.acoes_sugeridas ?? null,
        fontes_utilizadas: result.dados_extraidos ?? {},
        prompt_utilizado: prompt.substring(0, 500),
        modelo_ia: DEFAULT_MODEL,
        tokens_utilizados: { input: usage.input, output: usage.output, custo_estimado: 0 },
        status: 'gerada',
        created_by: usuario.id,
      })
      .select('id')
      .single()

    if (errAnalise) {
      return NextResponse.json({ error: 'Erro ao salvar análise' }, { status: 500 })
    }

    // Log de uso
    await logUsage({
      tenantId: usuario.tenant_id,
      userId: usuario.id,
      endpoint: 'analise',
      modelo: DEFAULT_MODEL,
      tokensInput: usage.input,
      tokensOutput: usage.output,
      latenciaMs: Date.now() - start,
    })

    return NextResponse.json({
      id: analise.id,
      ...result,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Erro desconhecido'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
