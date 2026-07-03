import { NextRequest } from 'next/server'
import { getAuthContext } from '@/lib/auth'
import { jsonError } from '@/lib/api'
import { streamCompletion, completionJSON } from '@/lib/anthropic/client'
import { modeloDaVersao } from '@/lib/anthropic/versoes'
import { verificarCota, mensagemCotaExcedida } from '@/lib/anthropic/quota'
import { decryptClienteFields, decryptField } from '@/lib/encryption'
import { buscarJurisprudencia, formatarParaPrompt, type ResultadoJurisprudencia } from '@/lib/jurisprudencia/datajud'
import { TRIBUNAIS_DEFAULT } from '@/lib/jurisprudencia/tribunais'
import { selecionarPromptPeca, type QualificacaoPartes } from '@/lib/ia/pecas/registro-pecas'
import { statusInicialPeca, anexarModeloEJurisprudencia, respostaStreamPeca, logUsagePosStream, salvarPecaPosStreamSeVazia } from '@/lib/ia/pecas/motor'
import { buildPromptRelevancia, SYSTEM_RELEVANCIA } from '@/lib/prompts/analise/relevancia-documentos'
import { SYSTEM_PECA_GENERICA, buildPromptPecaGenerica } from '@/lib/prompts/pecas/generico/peca'

// Geração de peça é a rota de IA mais pesada (streaming longo + jurisprudência +
// persistência pós-stream). Sem este teto ela cairia no default baixo da Vercel
// e poderia ser cortada no meio do stream (e o after() de salvamento junto).
export const maxDuration = 120
import { buscarModeloPadrao } from '@/lib/modelos/buscar-modelo'
import { AREAS, type AreaId } from '@/lib/constants/areas'
import { TIPOS_PECA } from '@/lib/constants/tipos-peca'

// Tipos (QualificacaoPartes) e o registro de prompts curados (PROMPT_MAP +
// selecionarPromptPeca) ficam em @/lib/ia/pecas/registro-pecas.

// POST /api/ia/gerar-peca — gerar peça com streaming SSE
export async function POST(req: NextRequest) {
  const start = Date.now()

  try {
    const { atendimentoId, analiseId, tipo, area, jurisprudencia, tribunais, qualificacao, versao } = await req.json() as {
      atendimentoId: string
      analiseId?: string
      tipo: string
      area: string
      jurisprudencia?: ResultadoJurisprudencia[]
      tribunais?: string[]
      qualificacao?: QualificacaoPartes
      versao?: string
    }

    if (!atendimentoId || !tipo || !area) {
      return jsonError('atendimentoId, tipo e area são obrigatórios', 400)
    }

    // Versão escolhida pelo usuário (Padrão x Raciocínio estendido) → modelo
    const modelo = modeloDaVersao(versao)

    const auth = await getAuthContext()
    if (!auth.ok) return auth.response
    const { supabase, usuario } = auth

    const cota = await verificarCota(supabase, usuario.tenant_id, 'gerar_peca')
    if (!cota.permitido) return jsonError(mensagemCotaExcedida(cota), 429)

    // Colaboradores não podem publicar diretamente — peça vai para fila de revisão
    const statusInicial = statusInicialPeca(usuario.role)

    // Buscar atendimento + documentos + dados completos do cliente
    const { data: atendimento } = await supabase
      .from('atendimentos')
      .select('*, documentos(*), clientes(nome, cpf, rg, orgao_expedidor, estado_civil, nacionalidade, profissao, endereco, bairro, cidade, estado, cep, telefone, email)')
      .eq('id', atendimentoId)
      .eq('tenant_id', usuario.tenant_id)
      .single()
    if (!atendimento) return jsonError('Atendimento não encontrado', 404)

    type ClienteDB = {
      nome?: string; cpf?: string; rg?: string; orgao_expedidor?: string
      estado_civil?: string; nacionalidade?: string; profissao?: string
      endereco?: string; bairro?: string; cidade?: string; estado?: string; cep?: string
      telefone?: string; email?: string
    } | null
    // Decifra CPF/RG (criptografados em repouso) antes de montar a qualificação
    const clienteDB = decryptClienteFields(atendimento.clientes as ClienteDB)

    const localizacao = {
      cidade: clienteDB?.cidade ?? undefined,
      estado: clienteDB?.estado ?? undefined,
    }

    // Construir qualificação base a partir do cadastro do cliente
    // Dados do request (extração por IA) complementam/sobrescrevem dados do BD
    const qualificacaoBase: QualificacaoPartes = { autor: {}, reu: qualificacao?.reu }
    if (clienteDB) {
      const campos: (keyof NonNullable<QualificacaoPartes['autor']>)[] = [
        'nome', 'cpf', 'rg', 'orgao_expedidor', 'estado_civil', 'nacionalidade',
        'profissao', 'endereco', 'bairro', 'cidade', 'estado', 'cep', 'telefone', 'email',
      ]
      for (const c of campos) {
        const dbVal = clienteDB[c as keyof ClienteDB]
        if (dbVal) qualificacaoBase.autor![c] = dbVal as string
      }
    }
    // Merge: dados da extração (request) sobrescrevem campos vazios do BD
    if (qualificacao?.autor) {
      for (const [k, v] of Object.entries(qualificacao.autor)) {
        if (v) (qualificacaoBase.autor as Record<string, string>)[k] = v
      }
    }
    const qualificacaoFinal = qualificacaoBase

    // Buscar análise (se existir)
    let analise: Record<string, unknown> | undefined
    if (analiseId) {
      const { data } = await supabase.from('analises').select('*').eq('id', analiseId).single()
      if (data) analise = data as Record<string, unknown>
    }

    // Operações independentes (jurisprudência e triagem de documentos) rodam
    // concorrentes via Promise.all para reduzir a latência até o 1º chunk.

    // Preparação dos documentos (necessária antes da triagem)
    type DocFiltrado = { id: string; tipo: string; texto_extraido: string; file_name: string }
    let documentosFiltrados: DocFiltrado[] = (atendimento.documentos ?? []).map((d: Record<string, unknown>) => ({
      id: d.id as string,
      tipo: d.tipo as string,
      texto_extraido: (d.texto_extraido as string) ?? '',
      file_name: d.file_name as string,
    }))
    const docsComTexto = documentosFiltrados.filter((d: DocFiltrado) => d.texto_extraido.trim().length > 50)

    // Promise: busca automática de jurisprudência se o advogado não pesquisou manualmente
    const jurispPromise = (async (): Promise<ResultadoJurisprudencia[]> => {
      let resultadosJurisp = jurisprudencia ?? []

      if (resultadosJurisp.length === 0) {
        const transcricao = decryptField(atendimento.transcricao_editada ?? atendimento.transcricao_raw ?? '')
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

      return resultadosJurisp
    })()

    // Promise: filtragem de relevância dos documentos por IA. Retorna o
    // conjunto de ids relevantes (ou null caso não haja triagem/falhe).
    const triagemPromise = (async (): Promise<Set<string> | null> => {
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
              transcricao: decryptField(atendimento.transcricao_editada ?? atendimento.transcricao_raw ?? ''),
              documentos: docsComTexto,
            }),
            maxTokens: 1024,
          })
          return new Set(triagem.relevantes.map((r) => r.id))
        } catch {
          // Falha silenciosa — inclui todos os documentos
          return null
        }
      }
      return null
    })()

    const [resultadosJurisp, idsRelevantes] = await Promise.all([jurispPromise, triagemPromise])

    const jurisprudenciaTexto = formatarParaPrompt(resultadosJurisp)

    if (idsRelevantes) {
      documentosFiltrados = documentosFiltrados.filter(
        (d: DocFiltrado) => idsRelevantes.has(d.id) || d.texto_extraido.trim().length <= 50
      )
    }

    // Buscar modelo padrão do escritório (se cadastrado)
    let modeloPadrao: string | null = null
    try {
      modeloPadrao = await buscarModeloPadrao(supabase, usuario.tenant_id, 'peca', tipo)
    } catch {
      // Falha silenciosa — segue sem modelo
    }

    // Selecionar prompt curado (área, tipo) — null cai no gerador genérico
    const promptConfig = selecionarPromptPeca({ area, tipo })
    if (!promptConfig) {
      // Sem prompt dedicado p/ (área, tipo) → gerador GENÉRICO ciente da área e do tipo.
      // (Antes caía no prompt de "petição inicial previdenciária" — viés errado.)
      const areaNome = AREAS[area as AreaId]?.nome ?? area
      const tipoNome = TIPOS_PECA[tipo]?.nome ?? tipo
      const promptBase = buildPromptPecaGenerica({
        areaNome,
        tipoNome,
        analise,
        transcricao: decryptField(atendimento.transcricao_editada ?? atendimento.transcricao_raw ?? ''),
        pedido_especifico: atendimento.pedidos_especificos,
        documentos: documentosFiltrados,
        localizacao,
        qualificacao: qualificacaoFinal,
      })
      const prompt = anexarModeloEJurisprudencia(promptBase, { modeloPadrao, jurisprudenciaTexto })

      // Cria a peça ANTES do stream para garantir um X-Peca-Id válido sempre.
      const { data: peca, error: pecaError } = await supabase
        .from('pecas')
        .insert({
          atendimento_id: atendimentoId,
          analise_id: analiseId ?? null,
          tenant_id: usuario.tenant_id,
          tipo,
          area,
          modelo_ia: modelo,
          status: statusInicial,
          created_by: usuario.id,
        })
        .select('id')
        .single()

      if (pecaError || !peca) {
        console.error('[gerar-peca] erro ao criar peça (fallback):', pecaError?.message)
        return jsonError('Erro ao criar registro da peça', 500)
      }

      const { stream, getUsage, getFinal } = await streamCompletion({ system: SYSTEM_PECA_GENERICA, prompt, maxTokens: 32768, model: modelo })

      // Loga o uso também no caminho de fallback genérico (antes escapava do dashboard).
      logUsagePosStream({ getUsage, tenantId: usuario.tenant_id, userId: usuario.id, endpoint: 'gerar_peca', modelo, start })
      // Rede de segurança: salva no servidor se o cliente não salvar (aba fechada).
      salvarPecaPosStreamSeVazia({ getFinal, pecaId: peca.id, atendimentoId })

      return respostaStreamPeca(stream, peca.id)
    }

    const documentos = documentosFiltrados

    const promptBase = promptConfig.build({
      analise,
      transcricao: decryptField(atendimento.transcricao_editada ?? atendimento.transcricao_raw ?? ''),
      pedido_especifico: atendimento.pedidos_especificos,
      documentos,
      localizacao,
      qualificacao: qualificacaoFinal,
    })
    const prompt = anexarModeloEJurisprudencia(promptBase, { modeloPadrao, jurisprudenciaTexto })

    // Criar peça no banco (status rascunho) ANTES do stream → X-Peca-Id sempre válido
    const { data: peca, error: pecaError } = await supabase
      .from('pecas')
      .insert({
        atendimento_id: atendimentoId,
        analise_id: analiseId ?? null,
        tenant_id: usuario.tenant_id,
        tipo,
        area,
        prompt_utilizado: prompt.substring(0, 500),
        modelo_ia: modelo,
        status: statusInicial,
        created_by: usuario.id,
      })
      .select('id')
      .single()

    if (pecaError || !peca) {
      console.error('[gerar-peca] erro ao criar peça:', pecaError?.message)
      return jsonError('Erro ao criar registro da peça', 500)
    }

    const { stream, getUsage, getFinal } = await streamCompletion({
      system: promptConfig.system,
      prompt,
      maxTokens: 32768,
      model: modelo,
    })

    // Log assíncrono (não bloqueia o stream)
    logUsagePosStream({ getUsage, tenantId: usuario.tenant_id, userId: usuario.id, endpoint: 'gerar_peca', modelo, start })
    // Rede de segurança: salva no servidor se o cliente não salvar (aba fechada no meio do stream).
    salvarPecaPosStreamSeVazia({ getFinal, pecaId: peca.id, atendimentoId })

    return respostaStreamPeca(stream, peca.id)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Erro desconhecido'
    console.error('[gerar-peca] Erro:', message, err)
    return jsonError(message, 500)
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
    trabalhista:    'rescisão contrato trabalho verbas trabalhistas',
    civel:          'indenização contrato responsabilidade civil dano',
    criminal:       'habeas corpus defesa criminal ação penal',
    tributario:     'tributo imposto lançamento fiscal autuação',
    empresarial:    'contrato empresarial societário recuperação judicial',
    familia:        'divórcio guarda alimentos pensão inventário sucessão família',
    medico:         'erro médico responsabilidade civil médica plano saúde dano paciente',
  }
  return termosPorArea[area] ?? 'direito jurisprudência'
}
