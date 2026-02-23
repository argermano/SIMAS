import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { completionJSON, DEFAULT_MODEL } from '@/lib/anthropic/client'
import { logUsage } from '@/lib/anthropic/usage'
import { buildPromptAnaliseGeral, SYSTEM_ANALISE_GERAL } from '@/lib/prompts/analise/geral'

export interface ResultadoAnaliseGeral {
  areas_identificadas: Array<{
    area: string
    nome: string
    relevancia: 'principal' | 'secundaria'
    justificativa: string
  }>
  resumo_caso:           string
  classificacao_provavel: string
  urgencia:              'alta' | 'media' | 'baixa'
  justificativa_urgencia: string
  recomendacao_imediata: string
  documentos_solicitar:  string[]
  perguntas_ao_cliente:  string[]
  observacoes?:          string
}

// POST /api/ia/analise-geral — análise multi-área sem área pré-definida
export async function POST(req: NextRequest) {
  const start = Date.now()

  try {
    const { transcricao, pedidoEspecifico, documentos, atendimentoId } = await req.json() as {
      transcricao:       string
      pedidoEspecifico?: string
      documentos?:       Array<{ tipo: string; texto_extraido: string; file_name: string }>
      atendimentoId?:    string
    }

    if (!transcricao?.trim()) {
      return NextResponse.json({ error: 'Descreva o caso para análise' }, { status: 400 })
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

    const prompt = buildPromptAnaliseGeral({ transcricao, pedido_especifico: pedidoEspecifico, documentos })

    const { result, usage } = await completionJSON<ResultadoAnaliseGeral>({
      system: SYSTEM_ANALISE_GERAL,
      prompt,
      maxTokens: 2048,
    })

    await logUsage({
      tenantId:    usuario.tenant_id,
      userId:      usuario.id,
      endpoint:    'analise_geral',
      modelo:      DEFAULT_MODEL,
      tokensInput:  usage.input,
      tokensOutput: usage.output,
      latenciaMs:   Date.now() - start,
    })

    // Salvar resultado na tabela analises se atendimentoId foi fornecido
    let analise_id: string | null = null
    if (atendimentoId) {
      try {
        const { data: analiseExistente } = await supabase
          .from('analises')
          .select('id')
          .eq('atendimento_id', atendimentoId)
          .single()

        const payload = {
          atendimento_id:      atendimentoId,
          tenant_id:           usuario.tenant_id,
          criado_por:          usuario.id,
          resumo_fatos:        result.resumo_caso,
          plano_a:             result as unknown as Record<string, unknown>,
          checklist_documentos: result.documentos_solicitar.map((nome: string) => ({ nome, entregue: false })),
          perguntas_faltantes:  result.perguntas_ao_cliente.map((pergunta: string) => ({ pergunta, respondida: false })),
          acoes_sugeridas:      [{ tipo: 'recomendacao_imediata', descricao: result.recomendacao_imediata }],
          status:              'gerada',
        }

        if (analiseExistente) {
          const { data: updated } = await supabase
            .from('analises')
            .update(payload)
            .eq('id', analiseExistente.id)
            .select('id')
            .single()
          analise_id = updated?.id ?? null
        } else {
          const { data: created } = await supabase
            .from('analises')
            .insert(payload)
            .select('id')
            .single()
          analise_id = created?.id ?? null
        }
      } catch {
        // Falha silenciosa — retorna resultado mesmo sem salvar
      }
    }

    return NextResponse.json({ ...result, analise_id })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Erro desconhecido'
    console.error('[analise-geral]', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
