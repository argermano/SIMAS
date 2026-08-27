// A ABSTRAÇÃO DE DRIVER da sessão de lapidação (§4 do PLANO-MOTOR-V3-OPUS.md).
//
// Existem duas implementações previstas, com a MESMA UI, os MESMOS dados e as
// mesmas ferramentas:
//   • 'messages' (Fase 0, F0.3) — uma chamada de streaming por rodada à Messages
//     API, dentro dos 300s da Vercel. É o que está no ar.
//   • 'managed'  (Fase 1)       — Managed Agents: o loop roda na Anthropic, a
//     Vercel vira cliente fino (proxy de SSE, reconexão por cursor, webhooks).
//
// A abstração existe HOJE, e não quando a Fase 1 chegar, por dois motivos: (a)
// se o beta dos Managed Agents mudar, a Fase 0 continua funcionando sem tocar em
// rota nem em UI; (b) as rotas e o painel são escritos uma vez, contra estes
// eventos — nada de `if (driver === 'managed')` espalhado pelo código.
//
// O contrato é o EVENTO. Tudo o que uma rodada produz chega como um
// EventoSessao; quem persiste (src/lib/ia/sessao/rodada.ts) e quem desenha
// (F0.4) só conhecem esta união.

import type { UsoTokens } from '@/lib/anthropic/client'
import type { PropostaRodada } from './envelope'

/** Implementações possíveis (coluna `pecas_sessoes.driver`). */
export type DriverSessao = 'messages' | 'managed'

/**
 * Eventos internos de uma rodada. São a fronteira entre o driver e o resto do
 * SIMAS: viram SSE para o navegador e turnos no banco, sem tradução por driver.
 */
export type EventoSessao =
  /** Pedaço de texto da resposta ao advogado (já em Markdown, não em JSON). */
  | { tipo: 'texto_delta'; texto: string }
  /** A rodada propôs um patch por seção. Ainda NÃO tocou na peça. */
  | { tipo: 'proposta'; proposta: PropostaRodada }
  /** Uma ferramenta foi usada (Fase 1/F0.5). Aqui só para o painel mostrar. */
  | { tipo: 'ferramenta'; nome: string; estado: 'inicio' | 'fim'; resumo?: string }
  /** Uso e custo de LISTA da rodada, assim que a API os informa. */
  | { tipo: 'custo'; uso: UsoTokens; custoUsd: number; modelo: string }
  /** Fim normal: o texto completo da resposta e por que o modelo parou. */
  | { tipo: 'fim'; respostaMarkdown: string; stopReason: string | null; degradado: boolean }
  /** Fim com falha. A rodada não produz proposta; o turno de erro é gravado. */
  | { tipo: 'erro'; mensagem: string }

/** Tudo o que uma rodada precisa para acontecer — já montado por quem chama. */
export interface EntradaRodada {
  /** System completo da sessão (curado + modo refinar + sessão). */
  system: string
  /** Primeiro turno `user`: contexto do caso (recebe o breakpoint de cache). */
  prefixoContexto: string
  /** Histórico já reconstruído dos turnos anteriores. */
  historico: import('@/lib/anthropic/client').MensagemIA[]
  /** Último turno `user`: peça atual + instrução desta rodada. */
  turnoAtual: string
  /** Modelo FIXO da sessão (trocar no meio invalidaria o cache). */
  modelo: string
  /** 'avancado' liga raciocínio adaptativo + esforço alto no client. */
  versao?: 'padrao' | 'avancado' | null
  maxTokens?: number
  /** Sinal de cancelamento (cliente desistiu da rodada). */
  signal?: AbortSignal
}

/** Estado do lado do provedor. Vazio no driver 'messages' (não há sessão remota). */
export interface EstadoRemoto {
  sessionId?: string | null
  agentId?: string | null
  agentVersion?: string | null
  ultimoEventoId?: string | null
}

/** Dados da sessão que o driver precisa para criar/retomar do lado do provedor. */
export interface ContextoSessaoDriver {
  sessaoId: string
  tenantId: string
  pecaId: string
  modelo: string
  remoto?: EstadoRemoto
}

export interface SessaoDriver {
  readonly nome: DriverSessao

  /**
   * Prepara a sessão do lado do provedor. No 'messages' não há nada a criar (a
   * Messages API é sem estado) — devolve vazio e a verdade fica toda no nosso
   * banco. No 'managed' é aqui que nasce a sessão remota e o container.
   */
  criar(ctx: ContextoSessaoDriver): Promise<EstadoRemoto>

  /**
   * Executa UMA rodada. O consumidor itera os eventos até 'fim' ou 'erro'; ele
   * é responsável por persistir (o driver não escreve no banco).
   */
  enviarMensagem(entrada: EntradaRodada): AsyncIterable<EventoSessao>

  /**
   * Retoma uma sessão existente. No 'messages' a retomada é puramente local (os
   * turnos estão no banco) — devolve `pendente: false`. No 'managed' reconecta
   * o stream a partir de `ultimoEventoId` e diz se há trabalho em andamento.
   */
  retomar(ctx: ContextoSessaoDriver): Promise<{ pendente: boolean; remoto: EstadoRemoto }>
}
