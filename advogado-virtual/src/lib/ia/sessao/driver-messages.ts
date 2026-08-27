// Driver 'messages' da sessão de lapidação (Fase 0 — F0.3).
//
// Uma rodada = UMA chamada de streaming multi-turno à Messages API, feita pelo
// client de sempre (src/lib/anthropic/client.ts). Sem beta, sem estado do lado
// da Anthropic, dentro dos 300s da Vercel: é o driver que sustenta a Fase 0
// inteira e continua sendo o plano B se o beta dos Managed Agents mudar.
//
// Três decisões que valem a leitura:
//
// 1. CACHE DE PROMPT — `cache: { system: true, primeiroUser: true }`. O system
//    (curado + modo + sessão) e o contexto do caso são o prefixo estável da
//    sessão; a partir da 2ª rodada eles voltam por 0,1× do preço de entrada.
//    Por isso o modelo é FIXO por sessão: trocá-lo invalidaria tudo.
//
// 2. STRUCTURED OUTPUT — a resposta é o envelope {resposta_markdown, proposta}
//    garantido por `output_config.format`. O que trafega no stream, portanto, é
//    JSON; um extrator incremental (extrator-campo.ts) desembrulha o campo de
//    texto EM TEMPO REAL para o painel não ficar mostrando chaves e aspas.
//
// 3. O DRIVER NÃO ESCREVE NO BANCO. Ele só emite eventos. Quem persiste turno,
//    proposta e custo é rodada.ts — é o que permite a Fase 1 trocar o driver
//    sem tocar em nada de persistência.

import type Anthropic from '@anthropic-ai/sdk'
import { streamCompletion, type MensagemIA } from '@/lib/anthropic/client'
import { baixarArquivo, metadadosArquivo, type ArquivoAnthropic } from '@/lib/anthropic/files'
import { createSSEParser, type SSEEvent } from '@/lib/sse-parser'
import { logger } from '@/lib/logger'
import {
  arquivoPermitido,
  arquivosDaResposta,
  tituloArtefato,
  MAX_ARTEFATOS_POR_RODADA,
  type MotivoIgnorado,
} from './artefatos'
import { custoDaRodada } from './custo'
import { CAMPO_RESPOSTA, ESQUEMA_ENVELOPE, lerEnvelope } from './envelope'
import { criarExtratorCampo } from './extrator-campo'
import type {
  ContextoSessaoDriver,
  EntradaRodada,
  EstadoRemoto,
  EventoSessao,
  SessaoDriver,
} from './driver'

/**
 * Modelo padrão da sessão. Sonnet 5 é o cavalo de batalha da lapidação (§4 do
 * plano): rodadas frequentes, contexto grande, custo por rodada que precisa
 * caber na franquia mensal do escritório.
 */
export const MODELO_SESSAO_PADRAO = process.env.ANTHROPIC_MODEL_SESSAO ?? 'claude-sonnet-5'

/** Modelo da sessão "avançada" — criação e revisão crítica. Escolhido na CRIAÇÃO. */
export const MODELO_SESSAO_AVANCADO = process.env.ANTHROPIC_MODEL_SESSAO_AVANCADO ?? 'claude-opus-5'

/**
 * Teto de saída de uma rodada. Uma proposta com 3 seções longas + a resposta ao
 * advogado passa folgada de 8k; 32k dá espaço sem risco de corte no meio de uma
 * seção (o que estragaria o JSON e cairia no modo degradado).
 */
export const MAX_TOKENS_RODADA = 32_768

/**
 * SERVER TOOL de execução de código (F0.5). É o que permite ao agente CALCULAR
 * de verdade (python no sandbox da Anthropic, sem internet) e produzir a
 * planilha de cálculos — que a rodada materializa sozinha no dossiê.
 *
 * Forma exata: `{ type: 'code_execution_20260521', name: 'code_execution' }` na
 * chamada NORMAL (`client.messages.stream`), sem header beta — skill claude-api,
 * "Server Tools (Quick Reference)": o tipo mais novo que o modelo suporta, e a
 * ressalva de beta vale só para o SDK Go. O resultado volta em blocos
 * `bash_code_execution_tool_result` (ver artefatos.ts).
 *
 * A env existe como válvula: se a Anthropic aposentar o tipo novo, dá para
 * voltar ao `code_execution_20260120` sem deploy de código.
 */
export const TIPO_CODE_EXECUTION = (process.env.ANTHROPIC_CODE_EXECUTION_TOOL ??
  'code_execution_20260521') as 'code_execution_20260521'

/**
 * Ferramentas da rodada. Lista CONSTANTE de propósito: as tools são o primeiro
 * bloco do prompt (tools → system → messages) e uma lista que variasse
 * invalidaria o cache do dossiê inteiro a cada rodada.
 *
 * Sem web tools na Fase 0 (§7 do plano): pesquisa em portais é da Fase 2, e
 * declarar `web_search`/`web_fetch` junto do code_execution confundiria o
 * modelo com dois ambientes de execução.
 */
export const FERRAMENTAS_SESSAO: Anthropic.ToolUnion[] = [
  { type: TIPO_CODE_EXECUTION, name: 'code_execution' },
]

/**
 * Quantas vezes uma rodada pode ser RETOMADA após `pause_turn`. O laço de
 * server tools da Anthropic pausa a cada ~10 iterações e espera que a gente
 * reenvie a conversa com a resposta parcial do assistente — sem "Continue.",
 * que o servidor detecta o bloco de ferramenta pendente e retoma sozinho
 * (skill claude-api → shared/tool-use-concepts.md, "Stop reasons for
 * server-side tools"). O teto existe para um modelo teimoso não gastar a
 * sessão inteira calculando.
 */
export const MAX_CONTINUACOES = 3

/** Modelo (e versão) da sessão a partir da escolha do advogado na criação. */
export function modeloDaSessao(versao?: string | null): { modelo: string; versao: 'padrao' | 'avancado' } {
  return versao === 'avancado'
    ? { modelo: MODELO_SESSAO_AVANCADO, versao: 'avancado' }
    : { modelo: MODELO_SESSAO_PADRAO, versao: 'padrao' }
}

/** Erro amigável para o caso clássico de crédito esgotado (já traduzido no client). */
function mensagemDeErro(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e ?? '')
  if (!msg) return 'Erro desconhecido na rodada'
  return msg
}

export class DriverMessages implements SessaoDriver {
  readonly nome = 'messages' as const

  /** A Messages API é sem estado: não há sessão remota a criar. */
  async criar(_ctx: ContextoSessaoDriver): Promise<EstadoRemoto> {
    return {}
  }

  /** Retomar é ler o banco — o histórico é nosso. Nunca há rodada pendente no servidor. */
  async retomar(ctx: ContextoSessaoDriver): Promise<{ pendente: boolean; remoto: EstadoRemoto }> {
    return { pendente: false, remoto: ctx.remoto ?? {} }
  }

  async *enviarMensagem(entrada: EntradaRodada): AsyncIterable<EventoSessao> {
    const extrator = criarExtratorCampo(CAMPO_RESPOSTA)

    // A conversa da rodada. Ela é REENVIADA inteira em cada retomada de
    // `pause_turn`, com a resposta parcial do assistente no fim — e nada mais:
    // um "Continue." nosso atrapalharia, porque o servidor reconhece o bloco de
    // ferramenta pendente e retoma sozinho.
    const mensagensBase: MensagemIA[] = [
      { role: 'user', content: entrada.prefixoContexto },
      ...entrada.historico,
      { role: 'user', content: entrada.turnoAtual },
    ]

    /** Texto acumulado do SSE (rede de segurança se o `getFinal` vier vazio). */
    let bruto = ''
    /** Texto autoritativo, somado através das retomadas. */
    let textoFinal = ''
    let stopReason: string | null = null
    const uso = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }
    /** Blocos de TODAS as chamadas — é neles que estão os arquivos gerados. */
    const blocos: unknown[] = []
    /** Só os blocos do assistente, para devolver à API na retomada. */
    const blocosAssistente: Anthropic.ContentBlock[] = []
    /**
     * Ferramentas da chamada. Vira `undefined` na rede de segurança abaixo: se a
     * API recusar a rodada ANTES de qualquer texto com as tools declaradas, a
     * sessão degrada para o comportamento da F0.4 (sem cálculos) em vez de
     * simplesmente falhar na cara do advogado.
     */
    let ferramentas: Anthropic.ToolUnion[] | undefined = FERRAMENTAS_SESSAO
    let degradouFerramentas = false

    for (let volta = 0; ; volta++) {
      const mensagens: MensagemIA[] =
        blocosAssistente.length === 0
          ? mensagensBase
          : [
              ...mensagensBase,
              // Os blocos de resposta voltam COMO VIERAM (inclusive os de
              // ferramenta). O cast existe porque o SDK tipa resposta e
              // parâmetro em uniões separadas; a forma no fio é a mesma.
              { role: 'assistant', content: blocosAssistente as unknown as Anthropic.ContentBlockParam[] },
            ]

      let chamada: Awaited<ReturnType<typeof streamCompletion>>
      try {
        chamada = await streamCompletion({
          system: entrada.system,
          messages: mensagens,
          model: entrada.modelo,
          versao: entrada.versao ?? 'padrao',
          maxTokens: entrada.maxTokens ?? MAX_TOKENS_RODADA,
          // O prefixo estável da sessão: system + contexto do caso.
          cache: { system: true, primeiroUser: true },
          formato: { type: 'json_schema', schema: ESQUEMA_ENVELOPE as unknown as Record<string, unknown> },
          ...(ferramentas ? { tools: ferramentas } : {}),
          signal: entrada.signal,
        })
      } catch (e) {
        // Falha ANTES do stream (teto de caracteres, chave ausente, 4xx).
        yield { tipo: 'erro', mensagem: mensagemDeErro(e) }
        return
      }

      // Lê o SSE do client e traduz para os eventos do driver. Reaproveitar o
      // parser do cliente aqui não é preciosismo: é o mesmo formato que a rota
      // devolve ao navegador, testado contra fragmentação de chunks.
      let erro: string | null = null
      try {
        for await (const ev of eventosDoStream(chamada.stream)) {
          if (ev.type === 'text' && typeof ev.text === 'string') {
            bruto += ev.text
            const texto = extrator.consumir(ev.text)
            if (texto) yield { tipo: 'texto_delta', texto }
          } else if (ev.type === 'ferramenta') {
            yield {
              tipo: 'ferramenta',
              nome: typeof ev.nome === 'string' ? ev.nome : 'code_execution',
              estado: ev.estado === 'inicio' ? 'inicio' : 'fim',
              ...(ev.erro ? { resumo: 'a execução falhou' } : {}),
            }
          } else if (ev.type === 'done') {
            stopReason = (ev.stopReason as string | null) ?? null
          } else if (ev.type === 'error') {
            erro = String(ev.error ?? 'Erro na geração')
          }
        }
      } catch (e) {
        erro = mensagemDeErro(e)
      }

      if (erro) {
        // Consome a promessa final mesmo no caminho de erro: deixá-la pendente
        // deixaria uma rejeição sem tratamento pendurada no processo.
        void chamada.getFinal().catch(() => {})

        // REDE DE SEGURANÇA das ferramentas: recusa antes de UM caractere de
        // resposta, com as tools declaradas, é sintoma de incompatibilidade do
        // lado da API (tipo do tool aposentado, combinação recusada). Tentar de
        // novo sem elas custa uma chamada e salva a rodada — o advogado perde o
        // cálculo, não a sessão. Só vale enquanto nada foi transmitido: com
        // texto já na tela, repetir duplicaria a resposta.
        if (ferramentas && !degradouFerramentas && bruto === '' && blocosAssistente.length === 0) {
          degradouFerramentas = true
          ferramentas = undefined
          logger.warn('ia.sessao.ferramentas.degradado', { modelo: entrada.modelo })
          continue
        }

        yield { tipo: 'erro', mensagem: erro }
        return
      }

      // O uso só existe depois que a mensagem fecha. `getFinal` é a fonte
      // autoritativa do texto (o acumulado do SSE deve bater, mas não dependemos
      // disso), do usage com as parcelas de cache e dos BLOCOS da resposta.
      let final: Awaited<ReturnType<Awaited<ReturnType<typeof streamCompletion>>['getFinal']>>
      try {
        final = await chamada.getFinal()
      } catch (e) {
        yield { tipo: 'erro', mensagem: mensagemDeErro(e) }
        return
      }

      textoFinal += final.text
      uso.input += final.usage.input
      uso.output += final.usage.output
      uso.cacheRead += final.usage.cacheRead
      uso.cacheWrite += final.usage.cacheWrite
      stopReason = final.stopReason ?? stopReason
      blocos.push(...final.content)
      blocosAssistente.push(...final.content)

      // `pause_turn`: o laço de server tools da Anthropic bateu no limite de
      // iterações. Reenviar a conversa retoma exatamente de onde parou.
      if (stopReason !== 'pause_turn') break
      if (volta >= MAX_CONTINUACOES) {
        logger.warn('ia.sessao.pause_turn.teto', { modelo: entrada.modelo, voltas: volta + 1 })
        break
      }
    }

    yield {
      tipo: 'custo',
      uso,
      custoUsd: custoDaRodada(uso, entrada.modelo),
      modelo: entrada.modelo,
    }

    // ARQUIVOS GERADOS NO SANDBOX (F0.5). O bloco de resultado traz só o
    // file_id; os bytes vêm da Files API. Nada aqui pode derrubar a rodada — na
    // pior das hipóteses o advogado fica sem o anexo e com a resposta inteira.
    const { fileIds, execucoes } = arquivosDaResposta(blocos)
    if (fileIds.length > 0) {
      try {
        const coleta = await coletarArquivosGerados(fileIds)
        if (coleta.arquivos.length > 0 || coleta.recusados.length > 0) {
          yield { tipo: 'arquivos', arquivos: coleta.arquivos, recusados: coleta.recusados }
        }
      } catch (e) {
        logger.error('ia.sessao.artefatos.coleta', { arquivos: fileIds.length }, e)
      }
    }

    const { envelope, degradado } = lerEnvelope(textoFinal || bruto)

    // O extrator já entregou o texto ao vivo; se a leitura final divergir (JSON
    // degradado, corte por max_tokens), manda o que faltou para o painel não
    // ficar com meia resposta.
    const jaEmitido = extrator.texto()
    if (envelope.resposta_markdown && envelope.resposta_markdown !== jaEmitido) {
      const resto = envelope.resposta_markdown.startsWith(jaEmitido)
        ? envelope.resposta_markdown.slice(jaEmitido.length)
        : `\n\n${envelope.resposta_markdown}`
      if (resto) yield { tipo: 'texto_delta', texto: resto }
    }

    if (envelope.proposta) yield { tipo: 'proposta', proposta: envelope.proposta }

    yield {
      tipo: 'fim',
      respostaMarkdown: envelope.resposta_markdown,
      stopReason,
      degradado,
      execucoes,
    }
  }
}

/** Lê um ReadableStream de SSE e entrega os eventos já interpretados. */
async function* eventosDoStream(stream: ReadableStream): AsyncGenerator<SSEEvent> {
  const parser = createSSEParser()
  const reader = stream.getReader()
  const decoder = new TextDecoder()
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      for (const ev of parser.feed(decoder.decode(value, { stream: true }))) yield ev
    }
    for (const ev of parser.flush()) yield ev
  } finally {
    reader.releaseLock()
  }
}

/**
 * Baixa os arquivos criados no container, aplicando a POLÍTICA antes do
 * download: extensão fora da allowlist ou tamanho acima do teto viram recusa
 * (com aviso no turno) — nunca 500 MB atravessando a função da Vercel.
 */
async function coletarArquivosGerados(fileIds: string[]): Promise<{
  arquivos: ArquivoAnthropic[]
  recusados: Array<{ titulo: string; motivo: MotivoIgnorado }>
}> {
  const arquivos: ArquivoAnthropic[] = []
  const recusados: Array<{ titulo: string; motivo: MotivoIgnorado }> = []

  for (const fileId of fileIds.slice(0, MAX_ARTEFATOS_POR_RODADA)) {
    try {
      const meta = await metadadosArquivo(fileId)
      const veredicto = arquivoPermitido({ nome: meta.nome, tamanho: meta.tamanho })
      if (!veredicto.ok) {
        recusados.push({ titulo: tituloArtefato(meta.nome), motivo: veredicto.motivo ?? 'sem_nome' })
        continue
      }
      if (!meta.baixavel) {
        recusados.push({ titulo: tituloArtefato(meta.nome), motivo: 'vazio' })
        continue
      }
      arquivos.push(await baixarArquivo(meta))
    } catch (e) {
      // LGPD: só o id do arquivo na Anthropic — nunca o nome (pode ter o nome do cliente).
      logger.error('ia.sessao.artefato.download', { fileId }, e)
    }
  }

  return { arquivos, recusados }
}

/** Instância única do driver da Fase 0. */
export const driverMessages = new DriverMessages()

/** Resolve o driver de uma sessão. Fase 1 acrescenta 'managed' aqui. */
export function driverDaSessao(driver: string | null | undefined): SessaoDriver {
  if (driver && driver !== 'messages') {
    throw new Error(`Driver de sessão não suportado nesta versão: ${driver}`)
  }
  return driverMessages
}
