// Montagem do CONTEXTO DO CASO para o motor de peças (F0.2 — "motor único").
//
// Este arquivo concentra tudo o que ANTES vivia dentro de
// src/app/api/ia/gerar-peca/route.ts (l. 62–258): busca do atendimento +
// documentos + cliente, decifragem dos campos sensíveis, montagem da
// qualificação das partes, triagem de relevância dos documentos por IA, busca
// automática de jurisprudência, modelo padrão do escritório, seleção do prompt
// curado (ou do gerador genérico) e o bloco de fundamentação verificada.
//
// A regra de ouro (§0 do PLANO-MOTOR-V3-OPUS.md): a extração NÃO pode alterar
// UM BYTE do prompt final da geração. Por isso `montarContextoPeca` devolve os
// INGREDIENTES (system + promptBase + documentos + meta) e quem compõe o texto
// final é `montarPromptDoModo` em ./motor.ts — cuja composição do modo 'criar' é
// exatamente `anexarModeloEJurisprudencia(promptBase, ...) + fundamentação`,
// idêntica à que a rota fazia inline.
//
// LGPD: nada aqui loga conteúdo — os textos do caso só transitam para o prompt.

import { completionJSON } from '@/lib/anthropic/client'
import { decryptClienteFields, decryptField } from '@/lib/encryption'
import { buscarJurisprudencia, formatarParaPrompt, type ResultadoJurisprudencia } from '@/lib/jurisprudencia/datajud'
import { TRIBUNAIS_DEFAULT } from '@/lib/jurisprudencia/tribunais'
import { selecionarPromptPeca, type QualificacaoPartes } from '@/lib/ia/pecas/registro-pecas'
import { buildPromptRelevancia, SYSTEM_RELEVANCIA } from '@/lib/prompts/analise/relevancia-documentos'
import { blocoFundamentacaoParaPrompt } from '@/lib/fundamentacao'
import { SYSTEM_PECA_GENERICA, buildPromptPecaGenerica } from '@/lib/prompts/pecas/generico/peca'
import { buscarModeloPadrao } from '@/lib/modelos/buscar-modelo'
import { formatarDocumentos, formatarQualificacao } from '@/lib/prompts/pecas/_shared/qualificacao'
import { AREAS, type AreaId } from '@/lib/constants/areas'
import { logger } from '@/lib/logger'
import { TIPOS_PECA } from '@/lib/constants/tipos-peca'
import type { createClient } from '@/lib/supabase/server'

type SupabaseServer = Awaited<ReturnType<typeof createClient>>

/** Documento do caso já triado, no formato que os prompts consomem. */
export interface DocumentoContexto {
  id: string
  tipo: string
  texto_extraido: string
  file_name: string
}

/**
 * Escopo da montagem:
 *  • 'completo' (modo criar) — jurisprudência automática, modelo padrão do
 *    escritório, fundamentação verificada e o `promptBase` da peça.
 *  • 'enxuto'  (refino/correção/editor) — só o que o refino precisa:
 *    documentos triados, qualificação e o system da área/tipo. Não gasta
 *    chamada de jurisprudência nem consulta modelo padrão.
 */
export type EscopoContexto = 'completo' | 'enxuto'

export interface ParametrosContextoPeca {
  supabase: SupabaseServer
  tenantId: string
  atendimentoId: string
  area: string
  tipo: string
  analiseId?: string | null
  /** Jurisprudência já pesquisada pelo advogado (vazio → busca automática). */
  jurisprudencia?: ResultadoJurisprudencia[]
  tribunais?: string[]
  /** Qualificação extraída por IA — complementa/sobrescreve o cadastro. */
  qualificacao?: QualificacaoPartes
  escopo?: EscopoContexto
}

export interface ContextoPeca {
  /** System do prompt curado da (área, tipo) — ou o genérico ciente da área. */
  system: string
  /** Prompt da peça SEM modelo/jurisprudência/fundamentação (só no escopo 'completo'). */
  promptBase: string
  /** Documentos do caso já filtrados pela triagem de relevância. */
  documentosContexto: DocumentoContexto[]
  meta: {
    atendimentoId: string
    area: string
    tipo: string
    /** true quando existe prompt curado para (área, tipo). */
    curado: boolean
    qualificacao: QualificacaoPartes
    localizacao: { cidade?: string; estado?: string }
    modeloPadrao: string | null
    jurisprudenciaTexto: string
    blocoFundamentacao: string
    totalDocumentos: number
    /** Quantos sobraram após a triagem de relevância. */
    documentosRelevantes: number
    triagemAplicada: boolean
  }
}

/**
 * Monta o contexto completo do caso para geração/refino de peça.
 * Devolve null quando o atendimento não existe (ou é de outro tenant) — quem
 * chama responde 404.
 */
export async function montarContextoPeca(params: ParametrosContextoPeca): Promise<ContextoPeca | null> {
  const { supabase, tenantId, atendimentoId, area, tipo } = params
  const escopo: EscopoContexto = params.escopo ?? 'completo'

  // Buscar atendimento + documentos + dados completos do cliente
  const { data: atendimento } = await supabase
    .from('atendimentos')
    .select('*, documentos(*), clientes(nome, cpf, rg, orgao_expedidor, estado_civil, nacionalidade, profissao, endereco, bairro, cidade, estado, cep, telefone, email)')
    .eq('id', atendimentoId)
    .eq('tenant_id', tenantId)
    .single()
  if (!atendimento) return null

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
  const qualificacaoBase: QualificacaoPartes = { autor: {}, reu: params.qualificacao?.reu }
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
  if (params.qualificacao?.autor) {
    for (const [k, v] of Object.entries(params.qualificacao.autor)) {
      if (v) (qualificacaoBase.autor as Record<string, string>)[k] = v
    }
  }
  const qualificacaoFinal = qualificacaoBase

  // Buscar análise (se existir)
  let analise: Record<string, unknown> | undefined
  if (params.analiseId) {
    const { data } = await supabase.from('analises').select('*').eq('id', params.analiseId).single()
    if (data) analise = data as Record<string, unknown>
  }

  // Operações independentes (jurisprudência e triagem de documentos) rodam
  // concorrentes via Promise.all para reduzir a latência até o 1º chunk.

  // Preparação dos documentos (necessária antes da triagem)
  let documentosFiltrados: DocumentoContexto[] = (atendimento.documentos ?? []).map((d: Record<string, unknown>) => ({
    id: d.id as string,
    tipo: d.tipo as string,
    texto_extraido: (d.texto_extraido as string) ?? '',
    file_name: d.file_name as string,
  }))
  const totalDocumentos = documentosFiltrados.length
  const docsComTexto = documentosFiltrados.filter((d: DocumentoContexto) => d.texto_extraido.trim().length > 50)

  // Promise: busca automática de jurisprudência se o advogado não pesquisou manualmente
  const jurispPromise = (async (): Promise<ResultadoJurisprudencia[]> => {
    // Escopo enxuto (refino/correção/editor): jurisprudência não entra no prompt.
    if (escopo !== 'completo') return []

    let resultadosJurisp = params.jurisprudencia ?? []

    if (resultadosJurisp.length === 0) {
      const transcricao = decryptField(atendimento.transcricao_editada ?? atendimento.transcricao_raw ?? '')
      const pedidos = atendimento.pedidos_especificos ?? ''
      const termosBusca = extrairTermosBusca(pedidos, transcricao, area)
      const tribunaisBusca = params.tribunais?.length ? params.tribunais : (TRIBUNAIS_DEFAULT[area] ?? TRIBUNAIS_DEFAULT.previdenciario)

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
      (d: DocumentoContexto) => idsRelevantes.has(d.id) || d.texto_extraido.trim().length <= 50
    )
  }

  // Buscar modelo padrão do escritório (se cadastrado)
  let modeloPadrao: string | null = null
  if (escopo === 'completo') {
    try {
      modeloPadrao = await buscarModeloPadrao(supabase, tenantId, 'peca', tipo)
    } catch {
      // Falha silenciosa — segue sem modelo
    }
  }

  // Selecionar prompt curado (área, tipo) — null cai no gerador genérico
  const promptConfig = selecionarPromptPeca({ area, tipo })

  const dadosPrompt = {
    analise,
    transcricao: decryptField(atendimento.transcricao_editada ?? atendimento.transcricao_raw ?? ''),
    pedido_especifico: atendimento.pedidos_especificos as string | undefined,
    documentos: documentosFiltrados,
    localizacao,
    qualificacao: qualificacaoFinal,
  }

  // Sem prompt dedicado p/ (área, tipo) → gerador GENÉRICO ciente da área e do tipo.
  // (Antes caía no prompt de "petição inicial previdenciária" — viés errado.)
  const areaNome = AREAS[area as AreaId]?.nome ?? area
  const tipoNome = TIPOS_PECA[tipo]?.nome ?? tipo

  // O promptBase só é usado pelo modo 'criar'; no escopo enxuto não vale o custo
  // de concatenar os documentos inteiros duas vezes na memória do handler.
  const promptBase =
    escopo !== 'completo'
      ? ''
      : promptConfig
        ? promptConfig.build(dadosPrompt)
        : buildPromptPecaGenerica({ areaNome, tipoNome, ...dadosPrompt })

  const blocoFundamentacao =
    escopo === 'completo' ? await blocoFundamentacaoParaPrompt(supabase, tenantId, area) : ''

  return {
    system: promptConfig ? promptConfig.system : SYSTEM_PECA_GENERICA,
    promptBase,
    documentosContexto: documentosFiltrados,
    meta: {
      atendimentoId,
      area,
      tipo,
      curado: promptConfig !== null,
      qualificacao: qualificacaoFinal,
      localizacao,
      modeloPadrao,
      jurisprudenciaTexto,
      blocoFundamentacao,
      totalDocumentos,
      documentosRelevantes: documentosFiltrados.length,
      triagemAplicada: idsRelevantes !== null,
    },
  }
}

/**
 * Contexto do caso a partir de uma PEÇA (o editor conhece a peça, não o
 * atendimento). Best-effort: devolve null se a peça sumiu, é de outro tenant ou
 * o dossiê falhou — quem chama segue sem contexto, nunca quebra a edição.
 */
export async function contextoDaPeca(params: {
  supabase: SupabaseServer
  tenantId: string
  pecaId: string
  escopo?: EscopoContexto
}): Promise<ContextoPeca | null> {
  try {
    const { data: peca } = await params.supabase
      .from('pecas')
      .select('atendimento_id, area, tipo')
      .eq('id', params.pecaId)
      .eq('tenant_id', params.tenantId)
      .single()
    if (!peca?.atendimento_id) return null

    return await montarContextoPeca({
      supabase: params.supabase,
      tenantId: params.tenantId,
      atendimentoId: peca.atendimento_id,
      area: peca.area,
      tipo: peca.tipo,
      escopo: params.escopo ?? 'enxuto',
    })
  } catch {
    // LGPD: só o id da peça — nunca o conteúdo do caso.
    logger.warn('ia.pecas.contexto_indisponivel', { pecaId: params.pecaId })
    return null
  }
}

/**
 * Bloco compacto de contexto do caso (qualificação + documentos relevantes)
 * para prompts que NÃO redigem a peça inteira — hoje o editor-documento com
 * `pecaId`. Sem jurisprudência, sem modelo padrão: só os fatos do dossiê para a
 * IA não inventar nome, CPF ou data ao editar um trecho.
 */
export function blocoContextoDoCaso(ctx: ContextoPeca): string {
  const comTexto = ctx.documentosContexto.filter((d) => d.texto_extraido.trim().length > 10)
  return [
    '## CONTEXTO DO CASO (referência — use apenas para conferir fatos, nomes, números e datas)',
    formatarQualificacao(ctx.meta.qualificacao),
    '',
    '### Documentos do caso:',
    formatarDocumentos(comTexto),
  ].join('\n')
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
