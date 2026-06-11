import { NextRequest, NextResponse } from 'next/server'
import { getAuthContext } from '@/lib/auth'
import { jsonError } from '@/lib/api'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { completionJSON, DEFAULT_MODEL } from '@/lib/anthropic/client'
import { logUsage } from '@/lib/anthropic/usage'
import { verificarCota, mensagemCotaExcedida } from '@/lib/anthropic/quota'
import { buildPromptAnaliseGeral, SYSTEM_ANALISE_GERAL } from '@/lib/prompts/analise/geral'

function getAdminSupabase() {
  return createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )
}

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
      return jsonError('Descreva o caso para análise', 400)
    }

    const auth = await getAuthContext()
    if (!auth.ok) return auth.response
    const { supabase, usuario } = auth

    const cota = await verificarCota(supabase, usuario.tenant_id, 'analise_geral')
    if (!cota.permitido) return jsonError(mensagemCotaExcedida(cota), 429)

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
      // Valida ownership ANTES de usar o admin client (que bypassa RLS):
      // o atendimento precisa pertencer ao tenant do usuário autenticado.
      const { data: atendimentoDoTenant } = await supabase
        .from('atendimentos')
        .select('id')
        .eq('id', atendimentoId)
        .eq('tenant_id', usuario.tenant_id)
        .single()

      if (!atendimentoDoTenant) {
        return jsonError('Atendimento não encontrado', 404)
      }

      try {
        const admin = getAdminSupabase()

        const { data: analiseExistente } = await admin
          .from('analises')
          .select('id')
          .eq('atendimento_id', atendimentoId)
          .eq('tenant_id', usuario.tenant_id)
          .single()

        const payload = {
          atendimento_id:      atendimentoId,
          tenant_id:           usuario.tenant_id,
          created_by:          usuario.id,
          resumo_fatos:        result.resumo_caso,
          plano_a:             result as unknown as Record<string, unknown>,
          checklist_documentos: result.documentos_solicitar.map((nome: string) => ({ nome, entregue: false })),
          perguntas_faltantes:  result.perguntas_ao_cliente.map((pergunta: string) => ({ pergunta, respondida: false })),
          acoes_sugeridas:      [{ tipo: 'recomendacao_imediata', descricao: result.recomendacao_imediata }],
          status:              'gerada',
        }

        if (analiseExistente) {
          const { data: updated, error: updErr } = await admin
            .from('analises')
            .update(payload)
            .eq('id', analiseExistente.id)
            .select('id')
            .single()
          if (updErr) console.error('[analise-geral] update error:', updErr.message)
          analise_id = updated?.id ?? null
        } else {
          const { data: created, error: insErr } = await admin
            .from('analises')
            .insert(payload)
            .select('id')
            .single()
          if (insErr) console.error('[analise-geral] insert error:', insErr.message)
          analise_id = created?.id ?? null
        }
      } catch (saveErr) {
        console.error('[analise-geral] save failed:', saveErr)
      }
    }

    return NextResponse.json({ ...result, analise_id })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Erro desconhecido'
    console.error('[analise-geral]', message)
    return jsonError(message, 500)
  }
}
