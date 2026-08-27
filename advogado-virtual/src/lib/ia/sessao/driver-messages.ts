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

import { streamCompletion } from '@/lib/anthropic/client'
import { createSSEParser } from '@/lib/sse-parser'
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
    let bruto = ''
    let stopReason: string | null = null

    let chamada: Awaited<ReturnType<typeof streamCompletion>>
    try {
      chamada = await streamCompletion({
        system: entrada.system,
        messages: [
          { role: 'user', content: entrada.prefixoContexto },
          ...entrada.historico,
          { role: 'user', content: entrada.turnoAtual },
        ],
        model: entrada.modelo,
        versao: entrada.versao ?? 'padrao',
        maxTokens: entrada.maxTokens ?? MAX_TOKENS_RODADA,
        // O prefixo estável da sessão: system + contexto do caso.
        cache: { system: true, primeiroUser: true },
        formato: { type: 'json_schema', schema: ESQUEMA_ENVELOPE as unknown as Record<string, unknown> },
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
    const parser = createSSEParser()
    const reader = chamada.stream.getReader()
    const decoder = new TextDecoder()
    let erro: string | null = null

    try {
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        const eventos = [...parser.feed(decoder.decode(value, { stream: true }))]
        for (const ev of eventos) {
          if (ev.type === 'text' && typeof ev.text === 'string') {
            bruto += ev.text
            const texto = extrator.consumir(ev.text)
            if (texto) yield { tipo: 'texto_delta', texto }
          } else if (ev.type === 'done') {
            stopReason = (ev.stopReason as string | null) ?? null
          } else if (ev.type === 'error') {
            erro = String(ev.error ?? 'Erro na geração')
          }
        }
      }
      for (const ev of parser.flush()) {
        if (ev.type === 'text' && typeof ev.text === 'string') {
          bruto += ev.text
          const texto = extrator.consumir(ev.text)
          if (texto) yield { tipo: 'texto_delta', texto }
        } else if (ev.type === 'error') {
          erro = String(ev.error ?? 'Erro na geração')
        }
      }
    } catch (e) {
      erro = mensagemDeErro(e)
    } finally {
      reader.releaseLock()
    }

    if (erro) {
      yield { tipo: 'erro', mensagem: erro }
      return
    }

    // O uso só existe depois que a mensagem fecha. `getFinal` é a fonte
    // autoritativa do texto (o acumulado do SSE deve bater, mas não dependemos
    // disso) e do usage com as parcelas de cache.
    let uso = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }
    try {
      const final = await chamada.getFinal()
      if (final.text) bruto = final.text
      uso = final.usage
      stopReason = final.stopReason ?? stopReason
    } catch (e) {
      yield { tipo: 'erro', mensagem: mensagemDeErro(e) }
      return
    }

    yield {
      tipo: 'custo',
      uso,
      custoUsd: custoDaRodada(uso, entrada.modelo),
      modelo: entrada.modelo,
    }

    const { envelope, degradado } = lerEnvelope(bruto)

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
    }
  }
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
