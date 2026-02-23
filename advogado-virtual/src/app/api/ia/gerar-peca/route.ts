import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { streamCompletion, completionJSON, DEFAULT_MODEL } from '@/lib/anthropic/client'
import { logUsage } from '@/lib/anthropic/usage'
import { buscarJurisprudencia, formatarParaPrompt, type ResultadoJurisprudencia } from '@/lib/jurisprudencia/datajud'
import { TRIBUNAIS_DEFAULT } from '@/lib/jurisprudencia/tribunais'
import { buildPromptPeticaoInicialPrev, SYSTEM_PETICAO_PREV } from '@/lib/prompts/pecas/previdenciario/peticao-inicial'
import { buildPromptContestacaoPrev, SYSTEM_CONTESTACAO_PREV } from '@/lib/prompts/pecas/previdenciario/contestacao'
import { buildPromptPeticaoInicialTrab, SYSTEM_PETICAO_TRAB } from '@/lib/prompts/pecas/trabalhista/peticao-inicial'
import { buildPromptContestacaoTrab, SYSTEM_CONTESTACAO_TRAB } from '@/lib/prompts/pecas/trabalhista/contestacao'
import { buildPromptRelevancia, SYSTEM_RELEVANCIA } from '@/lib/prompts/analise/relevancia-documentos'

type PromptBuilder = (dados: {
  analise?: Record<string, unknown>
  transcricao: string
  pedido_especifico?: string
  documentos: Array<{ tipo: string; texto_extraido: string; file_name: string }>
  localizacao?: { cidade?: string; estado?: string }
}) => string

const PROMPT_MAP: Record<string, Record<string, { system: string; build: PromptBuilder }>> = {
  previdenciario: {
    peticao_inicial: { system: SYSTEM_PETICAO_PREV, build: buildPromptPeticaoInicialPrev },
    contestacao:     { system: SYSTEM_CONTESTACAO_PREV, build: buildPromptContestacaoPrev },
  },
  trabalhista: {
    peticao_inicial: { system: SYSTEM_PETICAO_TRAB, build: buildPromptPeticaoInicialTrab },
    contestacao:     { system: SYSTEM_CONTESTACAO_TRAB, build: buildPromptContestacaoTrab },
  },
}

// POST /api/ia/gerar-peca — gerar peça com streaming SSE
export async function POST(req: NextRequest) {
  const start = Date.now()

  try {
    const { atendimentoId, analiseId, tipo, area, jurisprudencia, tribunais } = await req.json() as {
      atendimentoId: string
      analiseId?: string
      tipo: string
      area: string
      jurisprudencia?: ResultadoJurisprudencia[]
      tribunais?: string[]
    }

    if (!atendimentoId || !tipo || !area) {
      return NextResponse.json({ error: 'atendimentoId, tipo e area são obrigatórios' }, { status: 400 })
    }

    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })

    const { data: usuario } = await supabase
      .from('users')
      .select('id, tenant_id, role')
      .eq('auth_user_id', user.id)
      .single()
    if (!usuario) return NextResponse.json({ error: 'Usuário não encontrado' }, { status: 404 })

    // Colaboradores não podem publicar diretamente — peça vai para fila de revisão
    const statusInicial = usuario.role === 'colaborador' ? 'aguardando_revisao' : 'rascunho'

    // Buscar atendimento + documentos + localização do cliente
    const { data: atendimento } = await supabase
      .from('atendimentos')
      .select('*, documentos(*), clientes(cidade, estado)')
      .eq('id', atendimentoId)
      .eq('tenant_id', usuario.tenant_id)
      .single()
    if (!atendimento) return NextResponse.json({ error: 'Atendimento não encontrado' }, { status: 404 })

    const localizacao = {
      cidade: (atendimento.clientes as { cidade?: string; estado?: string } | null)?.cidade ?? undefined,
      estado: (atendimento.clientes as { cidade?: string; estado?: string } | null)?.estado ?? undefined,
    }

    // Buscar análise (se existir)
    let analise: Record<string, unknown> | undefined
    if (analiseId) {
      const { data } = await supabase.from('analises').select('*').eq('id', analiseId).single()
      if (data) analise = data as Record<string, unknown>
    }

    // Busca automática de jurisprudência se o advogado não pesquisou manualmente
    let resultadosJurisp = jurisprudencia ?? []

    if (resultadosJurisp.length === 0) {
      const transcricao = atendimento.transcricao_editada ?? atendimento.transcricao_raw ?? ''
      const pedidos = atendimento.pedidos_especificos ?? ''
      const termosBusca = extrairTermosBusca(pedidos, transcricao, area)
      const tribunaisBusca = tribunais?.length ? tribunais : (TRIBUNAIS_DEFAULT[area] ?? TRIBUNAIS_DEFAULT.previdenciario)

      if (termosBusca) {
        try {
          resultadosJurisp = await buscarJurisprudencia({
            termos: termosBusca,
            tribunais: tribunaisBusca,
            limite: 5,
          })
        } catch {
          // Se falhar, continua sem jurisprudência
        }
      }
    }

    const jurisprudenciaTexto = formatarParaPrompt(resultadosJurisp)

    // Filtragem de relevância dos documentos por IA (antes de qualquer caminho de geração)
    type DocFiltrado = { id: string; tipo: string; texto_extraido: string; file_name: string }
    let documentosFiltrados: DocFiltrado[] = (atendimento.documentos ?? []).map((d: Record<string, unknown>) => ({
      id: d.id as string,
      tipo: d.tipo as string,
      texto_extraido: (d.texto_extraido as string) ?? '',
      file_name: d.file_name as string,
    }))

    const docsComTexto = documentosFiltrados.filter((d: DocFiltrado) => d.texto_extraido.trim().length > 50)
    if (docsComTexto.length > 1) {
      try {
        const { result: triagem } = await completionJSON<{
          relevantes: Array<{ id: string; justificativa: string }>
          irrelevantes: Array<{ id: string; justificativa: string }>
        }>({
          system: SYSTEM_RELEVANCIA,
          prompt: buildPromptRelevancia({
            area,
            tipo_peca: tipo,
            pedido: atendimento.pedidos_especificos,
            transcricao: atendimento.transcricao_editada ?? atendimento.transcricao_raw ?? '',
            documentos: docsComTexto,
          }),
          maxTokens: 1024,
        })
        const idsRelevantes = new Set(triagem.relevantes.map((r) => r.id))
        documentosFiltrados = documentosFiltrados.filter(
          (d: DocFiltrado) => idsRelevantes.has(d.id) || d.texto_extraido.trim().length <= 50
        )
      } catch {
        // Falha silenciosa — inclui todos os documentos
      }
    }

    // Selecionar prompt
    const promptConfig = PROMPT_MAP[area]?.[tipo]
    if (!promptConfig) {
      // Fallback: usar petição inicial como base genérica
      const fallback = PROMPT_MAP[area]?.peticao_inicial ?? PROMPT_MAP.previdenciario.peticao_inicial
      let prompt = fallback.build({
        analise,
        transcricao: atendimento.transcricao_editada ?? atendimento.transcricao_raw ?? '',
        pedido_especifico: atendimento.pedidos_especificos,
        documentos: documentosFiltrados,
        localizacao,
      })

      if (jurisprudenciaTexto) {
        prompt += `\n\n${jurisprudenciaTexto}\n\nUse a jurisprudência acima como referência para fundamentar a peça. Cite os processos relevantes quando aplicável.`
      }

      const { stream } = await streamCompletion({ system: fallback.system, prompt })

      // Salvar peça (vazia por enquanto — será atualizada ao final do stream no frontend)
      const { data: peca } = await supabase
        .from('pecas')
        .insert({
          atendimento_id: atendimentoId,
          analise_id: analiseId ?? null,
          tenant_id: usuario.tenant_id,
          tipo,
          area,
          status: statusInicial,
          created_by: usuario.id,
        })
        .select('id')
        .single()

      return new Response(stream, {
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          Connection: 'keep-alive',
          'X-Peca-Id': peca?.id ?? '',
          'Access-Control-Expose-Headers': 'X-Peca-Id',
        },
      })
    }

    const documentos = documentosFiltrados

    let prompt = promptConfig.build({
      analise,
      transcricao: atendimento.transcricao_editada ?? atendimento.transcricao_raw ?? '',
      pedido_especifico: atendimento.pedidos_especificos,
      documentos,
      localizacao,
    })

    if (jurisprudenciaTexto) {
      prompt += `\n\n${jurisprudenciaTexto}\n\nUse a jurisprudência acima como referência para fundamentar a peça. Cite os processos relevantes quando aplicável.`
    }

    // Criar peça no banco (status rascunho)
    const { data: peca } = await supabase
      .from('pecas')
      .insert({
        atendimento_id: atendimentoId,
        analise_id: analiseId ?? null,
        tenant_id: usuario.tenant_id,
        tipo,
        area,
        prompt_utilizado: prompt.substring(0, 500),
        modelo_ia: DEFAULT_MODEL,
        status: statusInicial,
        created_by: usuario.id,
      })
      .select('id')
      .single()

    const { stream, getUsage } = await streamCompletion({
      system: promptConfig.system,
      prompt,
    })

    // Log assíncrono (não bloqueia o stream)
    getUsage().then(async (usage) => {
      await logUsage({
        tenantId: usuario.tenant_id,
        userId: usuario.id,
        endpoint: 'gerar_peca',
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
        'X-Peca-Id': peca?.id ?? '',
        'Access-Control-Expose-Headers': 'X-Peca-Id',
      },
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Erro desconhecido'
    console.error('[gerar-peca] Erro:', message, err)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

/**
 * Extrai termos de busca relevantes para jurisprudência a partir dos dados do caso.
 * Prioriza: pedido específico > transcrição (primeiras frases significativas)
 */
function extrairTermosBusca(pedidos: string, transcricao: string, area: string): string {
  // Se tem pedido específico, é o melhor termo de busca
  if (pedidos.trim()) {
    return pedidos.trim().substring(0, 200)
  }

  // Extrair termos relevantes da transcrição
  if (transcricao.trim()) {
    // Remove stop words comuns do português para focar nos termos jurídicos
    const stopWords = new Set([
      'a', 'o', 'e', 'é', 'de', 'do', 'da', 'dos', 'das', 'em', 'no', 'na',
      'nos', 'nas', 'um', 'uma', 'uns', 'umas', 'para', 'por', 'com', 'sem',
      'que', 'se', 'não', 'mais', 'muito', 'como', 'mas', 'ou', 'já', 'foi',
      'ele', 'ela', 'eu', 'me', 'meu', 'minha', 'seu', 'sua', 'nos', 'nós',
      'isso', 'isto', 'esse', 'essa', 'este', 'esta', 'ter', 'ser', 'está',
      'tem', 'vai', 'vou', 'pode', 'deve', 'ao', 'à', 'os', 'as', 'então',
      'porque', 'quando', 'onde', 'quem', 'qual', 'até', 'sobre', 'entre',
      'depois', 'antes', 'ainda', 'também', 'bem', 'só', 'mesmo', 'aqui',
      'lá', 'dia', 'ano', 'anos', 'vez', 'vezes', 'coisa', 'pessoa',
      'cliente', 'disse', 'falou', 'conta', 'caso', 'situação',
    ])

    const palavras = transcricao
      .toLowerCase()
      .replace(/[^\w\sáàâãéèêíìîóòôõúùûçñ]/g, ' ')
      .split(/\s+/)
      .filter(p => p.length > 3 && !stopWords.has(p))

    // Pega as primeiras palavras significativas (até 15)
    const termosUnicos = [...new Set(palavras)].slice(0, 15)
    if (termosUnicos.length > 0) {
      return termosUnicos.join(' ')
    }
  }

  // Fallback: termos genéricos por área
  const termosPorArea: Record<string, string> = {
    previdenciario: 'aposentadoria benefício previdenciário INSS',
    trabalhista: 'rescisão contrato trabalho verbas trabalhistas',
  }
  return termosPorArea[area] ?? 'direito jurisprudência'
}
