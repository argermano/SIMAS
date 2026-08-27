// Custo da sessão de lapidação (F0.3) — o medidor que a BarraCusto (F0.4) e o
// teto por sessão vão consumir.
//
// Tudo aqui é custo de LISTA em USD (o que a Anthropic cobra de nós). A
// conversão para reais e o markup do escritório são da Fase 3 (§10 do plano) e
// vivem em tenants.ia_config — não se misturam com este arquivo.

import { custoEstimadoUSD, precoDe, type PrecoModelo } from '@/lib/anthropic/usage'
import type { UsoTokens } from '@/lib/anthropic/client'

/** Acumulado de tokens da sessão (coluna `pecas_sessoes.tokens`). */
export interface TokensSessao {
  input: number
  output: number
  cache_read: number
  cache_write: number
  /**
   * Tokens de ENTRADA da última rodada (input + cache read + cache write). É a
   * melhor base para estimar a próxima — melhor que qualquer conta por
   * caracteres, porque já viveu o prompt de verdade.
   */
  ultima_entrada?: number
}

export const TOKENS_ZERADOS: TokensSessao = { input: 0, output: 0, cache_read: 0, cache_write: 0 }

/** Lê a coluna JSONB `tokens` de forma tolerante (sessão antiga, campo vazio). */
export function lerTokensSessao(bruto: unknown): TokensSessao {
  const t = (bruto ?? {}) as Record<string, unknown>
  const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0)
  return {
    input: n(t.input),
    output: n(t.output),
    cache_read: n(t.cache_read),
    cache_write: n(t.cache_write),
    ultima_entrada: n(t.ultima_entrada),
  }
}

/** Custo de LISTA (USD) de UMA rodada, com as parcelas de cache. */
export function custoDaRodada(uso: UsoTokens, modelo: string, quando: Date = new Date()): number {
  return custoEstimadoUSD({
    modelo,
    tokensInput: uso.input,
    tokensOutput: uso.output,
    tokensCacheRead: uso.cacheRead,
    tokensCacheWrite: uso.cacheWrite,
    quando,
  })
}

/** Soma o uso da rodada ao acumulado da sessão. */
export function acumularTokens(atual: TokensSessao, uso: UsoTokens): TokensSessao {
  return {
    input: atual.input + uso.input,
    output: atual.output + uso.output,
    cache_read: atual.cache_read + uso.cacheRead,
    cache_write: atual.cache_write + uso.cacheWrite,
    ultima_entrada: uso.input + uso.cacheRead + uso.cacheWrite,
  }
}

/**
 * Regra de bolso da API para converter texto em tokens. 4 caracteres por token
 * é a aproximação oficial para inglês; o português custa um pouco mais, e a
 * estimativa acaba conservadora para menos — por isso ela só serve para AVISAR
 * o advogado antes de uma rodada cara, nunca para cobrar (a cobrança usa o
 * `usage` real da resposta).
 */
export const CHARS_POR_TOKEN = 4

/** Saída típica de uma rodada de lapidação (proposta com 1–3 seções). */
export const TOKENS_SAIDA_ESTIMADOS = 4_000

export interface EstimativaRodada {
  tokensEntrada: number
  tokensSaida: number
  custoUsd: number
  /** De onde veio a estimativa: o uso real da última rodada ou a conta por caracteres. */
  base: 'ultima_rodada' | 'caracteres'
  /** Preço do modelo usado na conta (USD por milhão de tokens). */
  preco: Pick<PrecoModelo, 'input' | 'output'>
}

/**
 * Estimativa da PRÓXIMA rodada, para a UI avisar antes de gastar.
 *
 * Duas bases, nesta ordem: (1) se a sessão já rodou, os tokens de entrada da
 * última rodada — mais o que o histórico cresceu desde então; (2) na primeira
 * rodada, caracteres/4 do que já sabemos (system + contexto + peça + histórico).
 * A parcela cacheada NÃO é descontada de propósito: a estimativa é o TETO da
 * rodada, e prometer menos do que pode custar seria o erro caro.
 */
export function estimarProximaRodada(params: {
  modelo: string
  tokens?: TokensSessao | null
  /** Caracteres do system + contexto do caso + peça atual + histórico. */
  chars: number
  tokensSaida?: number
  quando?: Date
}): EstimativaRodada {
  const preco = precoDe(params.modelo, params.quando ?? new Date())
  const porChars = Math.ceil(Math.max(0, params.chars) / CHARS_POR_TOKEN)
  const ultima = params.tokens?.ultima_entrada ?? 0

  const base: EstimativaRodada['base'] = ultima > 0 ? 'ultima_rodada' : 'caracteres'
  const tokensEntrada = base === 'ultima_rodada' ? Math.max(ultima, porChars) : porChars
  const tokensSaida = params.tokensSaida ?? TOKENS_SAIDA_ESTIMADOS

  const custoUsd = (tokensEntrada / 1_000_000) * preco.input + (tokensSaida / 1_000_000) * preco.output

  return { tokensEntrada, tokensSaida, custoUsd, base, preco }
}
