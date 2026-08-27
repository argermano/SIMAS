// UMA RODADA da sessão de lapidação (F0.3): preparo do contexto, execução do
// driver em SSE e persistência do turno/proposta/custo.
//
// Regra de ouro do plano (§4): a sessão NUNCA grava `pecas.conteudo_markdown`.
// Uma rodada produz, no máximo, uma PROPOSTA pendente. Quem transforma proposta
// em versão da peça é o endpoint de decisão (decidir.ts), depois do aceite do
// advogado, seção por seção.
//
// A ordem de escrita importa: o turno do advogado é gravado ANTES da chamada de
// IA (se a rodada falhar, a instrução dele não se perde) e o turno do agente
// depois do stream, com o custo e o relatório de citações já anexados.

import { after } from 'next/server'
import { safeLogUsage } from '@/lib/anthropic/usage'
import { verificarCitacoes } from '@/lib/jurisprudencia/verificador-citacoes'
import { logger } from '@/lib/logger'
import { montarContextoPeca, type ContextoPeca } from '@/lib/ia/pecas/contexto'
import { descreverPatch } from '@/lib/diff/patch-secoes'
import { garantirResumosDosGrandes } from '@/lib/documentos/resumir'
import { acumularTokens, lerTokensSessao } from './custo'
import { driverDaSessao, MAX_TOKENS_RODADA } from './driver-messages'
import { textoDaProposta, type PropostaRodada } from './envelope'
import { montarSystemSessao } from './prompts'
import {
  historicoParaMensagens,
  montarPrefixoContexto,
  montarRodada,
  montarTurnoDaRodada,
  type DocumentoSessao,
} from './montagem'
import {
  documentosDaSessao,
  inserirTurno,
  listarTurnos,
  rotulosDaPeca,
  tocarSessao,
  type PecaDaSessao,
  type SessaoPeca,
  type SupabaseAdmin,
  type TurnoPeca,
} from './sessoes'
import type { EventoSessao } from './driver'
import type { createClient } from '@/lib/supabase/server'

type SupabaseServer = Awaited<ReturnType<typeof createClient>>

/** Endpoint do medidor (entra em CATEGORIAS como 'Sessão de lapidação'). */
export const ENDPOINT_SESSAO = 'sessao_peca'

export interface ParametrosRodada {
  supabase: SupabaseServer
  admin: SupabaseAdmin
  tenantId: string
  usuarioId: string
  peca: PecaDaSessao
  sessao: SessaoPeca
  instrucao: string
}

/** O que a preparação produziu (também usado pela estimativa de custo do GET). */
export interface PreparoRodada {
  system: string
  prefixoContexto: string
  historico: ReturnType<typeof historicoParaMensagens>
  turnoAtual: string
  chars: number
  cortadas: number
  ctx: ContextoPeca | null
  documentos: DocumentoSessao[]
}

/**
 * Monta tudo o que a rodada precisa: contexto do caso (escopo enxuto — a
 * jurisprudência automática e o modelo padrão são coisas da CRIAÇÃO da peça,
 * não da lapidação), documentos com os grandes resumidos, histórico dos turnos
 * e o turno desta rodada.
 */
export async function prepararRodada(params: {
  supabase: SupabaseServer
  admin: SupabaseAdmin
  tenantId: string
  usuarioId: string
  peca: PecaDaSessao
  sessao: SessaoPeca
  instrucao: string
  turnos?: TurnoPeca[]
}): Promise<PreparoRodada> {
  const ctx = await montarContextoPeca({
    supabase: params.supabase,
    tenantId: params.tenantId,
    atendimentoId: params.peca.atendimento_id,
    area: params.peca.area,
    tipo: params.peca.tipo,
    escopo: 'enxuto',
  })

  const documentos = await documentosDaSessao(params.admin, {
    sessaoId: params.sessao.id,
    tenantId: params.tenantId,
    idsDoContexto: (ctx?.documentosContexto ?? []).map((d) => d.id),
  })

  // Documento grande entra por RESUMO; os que ainda não têm, ganham um agora.
  const resumos = await garantirResumosDosGrandes(params.admin, {
    tenantId: params.tenantId,
    userId: params.usuarioId,
    documentos,
  })
  for (const doc of documentos) {
    const novo = resumos.get(doc.id)
    if (novo) doc.resumo_ia = novo
  }

  const { areaNome, tipoNome } = rotulosDaPeca(params.peca)
  const system = montarSystemSessao(ctx)
  const prefixoContexto = montarPrefixoContexto({ ctx, documentos, areaNome, tipoNome })

  const turnos = params.turnos ?? (await listarTurnos(params.admin, params.sessao.id))
  const historicoBruto = historicoParaMensagens(
    turnos.map((t) => ({
      papel: t.papel,
      blocos: (t.payload?.blocos as string[] | undefined) ?? null,
    })),
  )

  const turnoAtual = montarTurnoDaRodada({
    pecaAtual: params.peca.conteudo_markdown ?? '',
    versao: params.peca.versao ?? 1,
    instrucao: params.instrucao,
  })

  const montada = montarRodada({ system, prefixoContexto, historico: historicoBruto, turnoAtual })

  return {
    system,
    prefixoContexto,
    historico: montada.historico,
    turnoAtual,
    chars: montada.chars,
    cortadas: montada.cortadas,
    ctx,
    documentos,
  }
}

/** Serializa um objeto como um evento SSE. */
function sse(dado: unknown): Uint8Array {
  return new TextEncoder().encode(`data: ${JSON.stringify(dado)}\n\n`)
}

/**
 * Executa a rodada e devolve a resposta SSE. Acumula tudo do lado do servidor:
 * se o advogado fechar a aba no meio, a rodada TERMINA e é persistida do mesmo
 * jeito (mesma filosofia da rede de segurança pós-stream da geração de peça) —
 * o que ele pagou não se perde.
 */
export async function executarRodada(params: ParametrosRodada): Promise<Response> {
  const inicio = Date.now()
  const { admin, sessao, peca } = params

  const preparo = await prepararRodada(params)

  // Compactação local do histórico (teto de MAX_PROMPT_CHARS): registra o fato
  // em um turno de sistema, para o advogado entender por que o agente "esqueceu"
  // o começo da conversa.
  if (preparo.cortadas > 0) {
    await inserirTurno(admin, {
      sessaoId: sessao.id,
      papel: 'sistema',
      tipo: 'ferramenta',
      conteudo: `Contexto compactado localmente: ${preparo.cortadas} mensagem(ns) antiga(s) do histórico saíram desta rodada para caber no limite do modelo.`,
      payload: { compactacao: { mensagens_descartadas: preparo.cortadas } },
    })
  }

  // O turno do advogado é gravado ANTES da IA: instrução dada é instrução salva.
  const turnoAdvogado = await inserirTurno(admin, {
    sessaoId: sessao.id,
    papel: 'advogado',
    tipo: 'instrucao',
    conteudo: params.instrucao,
    payload: { blocos: [params.instrucao] },
    criadoPor: params.usuarioId,
  })

  const driver = driverDaSessao(sessao.driver)
  const eventos = driver.enviarMensagem({
    system: preparo.system,
    prefixoContexto: preparo.prefixoContexto,
    historico: preparo.historico,
    turnoAtual: preparo.turnoAtual,
    modelo: sessao.modelo,
    versao: sessao.effort === 'high' ? 'avancado' : 'padrao',
    maxTokens: MAX_TOKENS_RODADA,
  })

  let persistido = false
  let resposta = ''
  let proposta: PropostaRodada | undefined
  let uso = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }
  let custoUsd = 0
  let stopReason: string | null = null
  let degradado = false
  let erro: string | null = null

  /** Grava turno do agente + proposta + custo. Roda uma vez só. */
  async function persistir(): Promise<{ turnoId: string | null; propostaId: string | null }> {
    if (persistido) return { turnoId: null, propostaId: null }
    persistido = true

    if (erro) {
      await inserirTurno(admin, {
        sessaoId: sessao.id,
        papel: 'sistema',
        tipo: 'erro',
        conteudo: erro,
        payload: { erro: true },
      })
      await tocarSessao(admin, sessao.id)
      return { turnoId: null, propostaId: null }
    }

    // Verificação determinística de citações sobre a resposta E a proposta —
    // grátis, síncrona e por rodada (§7 do plano): o selo aparece antes de o
    // advogado aceitar qualquer coisa.
    const citacoes = verificarCitacoes(`${resposta}\n\n${textoDaProposta(proposta)}`)

    const blocoHistorico = proposta
      ? `${resposta}\n\n(Proposta enviada ao advogado — aguardando decisão)\n${descreverPatch(proposta.secoes)}`
      : resposta

    const turno = await inserirTurno(admin, {
      sessaoId: sessao.id,
      papel: 'agente',
      tipo: proposta ? 'proposta' : 'resposta',
      conteudo: resposta,
      payload: {
        blocos: [blocoHistorico],
        citacoes,
        degradado,
        stop_reason: stopReason,
        modelo: sessao.modelo,
        ...(proposta ? { proposta_resumo: proposta.resumo, secoes: proposta.secoes.length } : {}),
      },
      custoUsd,
      tokens: {
        input: uso.input,
        output: uso.output,
        cache_read: uso.cacheRead,
        cache_write: uso.cacheWrite,
      },
    })

    let propostaId: string | null = null
    if (proposta && turno) {
      const { data } = await admin
        .from('pecas_propostas')
        .insert({
          sessao_id: sessao.id,
          turno_id: turno.id,
          versao_base: peca.versao ?? 1,
          resumo: proposta.resumo,
          patch: proposta.secoes,
          status: 'pendente',
        })
        .select('id')
        .single()
      propostaId = (data?.id as string | undefined) ?? null
      if (propostaId) {
        await admin.from('pecas_turnos').update({ proposta_id: propostaId }).eq('id', turno.id)
      }
    }

    const tokensSessao = acumularTokens(lerTokensSessao(sessao.tokens), uso)
    await tocarSessao(admin, sessao.id, {
      tokens: tokensSessao,
      custo_lista_usd: Number(sessao.custo_lista_usd ?? 0) + custoUsd,
    })

    await safeLogUsage({
      tenantId: params.tenantId,
      userId: params.usuarioId,
      endpoint: ENDPOINT_SESSAO,
      modelo: sessao.modelo,
      tokensInput: uso.input,
      tokensOutput: uso.output,
      tokensCacheRead: uso.cacheRead,
      tokensCacheWrite: uso.cacheWrite,
      latenciaMs: Date.now() - inicio,
      sessaoId: sessao.id,
      turnoId: turno?.id ?? null,
      origem: 'messages',
    })

    // LGPD: ids e contagens — nada da instrução, da peça ou dos documentos.
    logger.info('ia.sessao.rodada', {
      sessaoId: sessao.id,
      pecaId: peca.id,
      turnoId: turno?.id ?? null,
      propostaId,
      secoes: proposta?.secoes.length ?? 0,
      citacoes: citacoes.total,
      citacoesProblema: citacoes.problemas,
      cacheRead: uso.cacheRead,
      degradado,
      ms: Date.now() - inicio,
    })

    return { turnoId: turno?.id ?? null, propostaId }
  }

  const stream = new ReadableStream({
    async start(controller) {
      let aberto = true
      const enviar = (dado: unknown) => {
        if (!aberto) return
        try {
          controller.enqueue(sse(dado))
        } catch {
          // Cliente desconectou: paramos de transmitir, mas NÃO paramos a
          // rodada — ela termina e é persistida.
          aberto = false
        }
      }

      try {
        for await (const ev of eventos as AsyncIterable<EventoSessao>) {
          switch (ev.tipo) {
            case 'texto_delta':
              resposta += ev.texto
              enviar({ type: 'text', text: ev.texto })
              break
            case 'ferramenta':
              enviar({ type: 'ferramenta', nome: ev.nome, estado: ev.estado, resumo: ev.resumo })
              break
            case 'custo':
              uso = ev.uso
              custoUsd = ev.custoUsd
              enviar({
                type: 'custo',
                custoUsd: ev.custoUsd,
                tokens: { input: uso.input, output: uso.output, cacheRead: uso.cacheRead, cacheWrite: uso.cacheWrite },
              })
              break
            case 'proposta':
              proposta = ev.proposta
              break
            case 'fim':
              resposta = ev.respostaMarkdown || resposta
              stopReason = ev.stopReason
              degradado = ev.degradado
              break
            case 'erro':
              erro = ev.mensagem
              break
          }
        }
      } catch (e) {
        erro = e instanceof Error ? e.message : 'Erro inesperado na rodada'
      }

      try {
        const ids = await persistir()
        if (erro) {
          enviar({ type: 'error', error: erro })
        } else {
          enviar({
            type: 'done',
            turnoId: ids.turnoId,
            propostaId: ids.propostaId,
            proposta: proposta ?? null,
            respostaMarkdown: resposta,
            custoUsd,
            tokens: { input: uso.input, output: uso.output, cacheRead: uso.cacheRead, cacheWrite: uso.cacheWrite },
            custoSessaoUsd: Number(sessao.custo_lista_usd ?? 0) + custoUsd,
            degradado,
            stopReason,
          })
        }
      } catch (e) {
        logger.error('ia.sessao.persistencia_falhou', { sessaoId: sessao.id, pecaId: peca.id }, e)
        enviar({ type: 'error', error: 'A rodada terminou, mas houve falha ao registrá-la. Recarregue a sessão.' })
      }

      controller.close()
    },
  })

  // Rede de segurança: se a função for interrompida antes do fim do stream (o
  // caso do cliente que fecha a aba na Vercel), o after() ainda tenta persistir
  // o que existir. `persistir()` é guardada por flag — nunca grava duas vezes.
  after(async () => {
    if (persistido) return
    try {
      await persistir()
    } catch (e) {
      logger.error('ia.sessao.persistencia_pos_stream_falhou', { sessaoId: sessao.id }, e)
    }
  })

  logger.info('ia.sessao.rodada_iniciada', {
    sessaoId: sessao.id,
    pecaId: peca.id,
    turnoId: turnoAdvogado?.id ?? null,
    documentos: preparo.documentos.length,
    chars: preparo.chars,
    cortadas: preparo.cortadas,
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Sessao-Id': sessao.id,
      'Access-Control-Expose-Headers': 'X-Sessao-Id',
    },
  })
}
