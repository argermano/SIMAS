import { NextRequest, NextResponse } from 'next/server'
import { completionJSON, DEFAULT_MODEL } from '@/lib/anthropic/client'
import { logUsage } from '@/lib/anthropic/usage'
import { verificarCota, mensagemCotaExcedida } from '@/lib/anthropic/quota'
import { buildPromptAnalisePrev, SYSTEM_ANALISE_PREV } from '@/lib/prompts/analise/previdenciario'
import { buildPromptAnaliseTrab, SYSTEM_ANALISE_TRAB } from '@/lib/prompts/analise/trabalhista'
import { buildPromptAnaliseGenerica, SYSTEM_ANALISE_GENERICA } from '@/lib/prompts/analise/generico'
import { AREAS, type AreaId } from '@/lib/constants/areas'
import { decryptField } from '@/lib/encryption'
import { getAuthContext } from '@/lib/auth'
import { jsonError } from '@/lib/api'

export const maxDuration = 120

// Dados comuns a todos os prompts de análise
type DadosAnalise = {
  transcricao: string
  pedido_especifico?: string
  documentos: Array<{ tipo: string; texto_extraido: string; file_name: string }>
  tipo_peca_origem?: string
}

// Registro de prompts curados por área. Áreas sem entrada caem no genérico
// ciente da área (não mais no previdenciário). Cf. princípio "prompts curados
// por área+peça": basta adicionar uma entrada aqui para curar uma nova área.
const REGISTRO_ANALISE: Record<string, { system: string; build: (d: DadosAnalise) => string }> = {
  previdenciario: { system: SYSTEM_ANALISE_PREV, build: buildPromptAnalisePrev },
  trabalhista:    { system: SYSTEM_ANALISE_TRAB, build: buildPromptAnaliseTrab },
}

// POST /api/ia/analise — gerar análise jurídica
export async function POST(req: NextRequest) {
  const start = Date.now()

  try {
    const { atendimentoId } = await req.json()
    if (!atendimentoId) {
      return jsonError('atendimentoId é obrigatório', 400)
    }

    const auth = await getAuthContext()
    if (!auth.ok) return auth.response
    const { supabase, usuario } = auth

    const cota = await verificarCota(supabase, usuario.tenant_id, 'analise')
    if (!cota.permitido) return jsonError(mensagemCotaExcedida(cota), 429)

    // Buscar atendimento com documentos
    const { data: atendimento } = await supabase
      .from('atendimentos')
      .select('*, documentos(*)')
      .eq('id', atendimentoId)
      .eq('tenant_id', usuario.tenant_id)
      .single()

    if (!atendimento) return jsonError('Atendimento não encontrado', 404)

    const transcricao = decryptField(atendimento.transcricao_editada ?? atendimento.transcricao_raw ?? '')
    if (!transcricao.trim()) {
      return jsonError('Atendimento sem transcrição ou texto', 400)
    }

    const documentos = (atendimento.documentos ?? []).map((d: Record<string, unknown>) => ({
      tipo: d.tipo as string,
      texto_extraido: (d.texto_extraido as string) ?? '',
      file_name: d.file_name as string,
    }))

    // Selecionar prompt por área — curado (registro) ou genérico ciente da área
    const dadosAnalise: DadosAnalise = {
      transcricao,
      pedido_especifico: atendimento.pedidos_especificos,
      documentos,
      tipo_peca_origem: atendimento.tipo_peca_origem,
    }

    const curado = REGISTRO_ANALISE[atendimento.area as string]
    let system: string
    let prompt: string

    if (curado) {
      system = curado.system
      prompt = curado.build(dadosAnalise)
    } else {
      const areaNome = AREAS[atendimento.area as AreaId]?.nome ?? 'Direito (área geral)'
      system = SYSTEM_ANALISE_GENERICA
      prompt = buildPromptAnaliseGenerica({ areaNome, ...dadosAnalise })
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
      return jsonError('Erro ao salvar análise', 500)
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
    return jsonError(message, 500)
  }
}
