import { describe, it, expect } from 'vitest'
import {
  acumularTokens,
  custoDaRodada,
  estimarProximaRodada,
  lerTokensSessao,
  CHARS_POR_TOKEN,
  TOKENS_ZERADOS,
} from './custo'

const uso = (over: Partial<{ input: number; output: number; cacheRead: number; cacheWrite: number }> = {}) => ({
  input: 0, output: 0, cacheRead: 0, cacheWrite: 0, ...over,
})

describe('custoDaRodada', () => {
  it('cobra input e output pelo preço do modelo', () => {
    // Opus 5: 5/25 por milhão.
    const c = custoDaRodada(uso({ input: 1_000_000, output: 100_000 }), 'claude-opus-5')
    expect(c).toBeCloseTo(5 + 2.5, 6)
  })

  it('leitura de cache custa 0,1× o input — é a economia das rodadas 2+', () => {
    const semCache = custoDaRodada(uso({ input: 200_000 }), 'claude-opus-5')
    const comCache = custoDaRodada(uso({ input: 0, cacheRead: 200_000 }), 'claude-opus-5')
    expect(comCache).toBeCloseTo(semCache * 0.1, 6)
  })

  it('escrita de cache (TTL 1h) custa 2× o input', () => {
    const escrita = custoDaRodada(uso({ cacheWrite: 100_000 }), 'claude-opus-5')
    expect(escrita).toBeCloseTo((100_000 / 1_000_000) * 5 * 2, 6)
  })

  it('respeita a vigência do preço de introdução do Sonnet 5', () => {
    const intro = custoDaRodada(uso({ input: 1_000_000 }), 'claude-sonnet-5', new Date('2026-08-31T12:00:00Z'))
    const cheio = custoDaRodada(uso({ input: 1_000_000 }), 'claude-sonnet-5', new Date('2026-09-01T12:00:00Z'))
    expect(intro).toBeCloseTo(2, 6)
    expect(cheio).toBeCloseTo(3, 6)
  })
})

describe('acumularTokens / lerTokensSessao', () => {
  it('soma as parcelas e guarda a entrada da última rodada', () => {
    const t1 = acumularTokens(TOKENS_ZERADOS, uso({ input: 10, output: 5, cacheWrite: 100 }))
    expect(t1).toEqual({ input: 10, output: 5, cache_read: 0, cache_write: 100, ultima_entrada: 110 })

    const t2 = acumularTokens(t1, uso({ input: 2, output: 7, cacheRead: 100 }))
    expect(t2).toEqual({ input: 12, output: 12, cache_read: 100, cache_write: 100, ultima_entrada: 102 })
  })

  it('lê JSONB bagunçado sem quebrar', () => {
    expect(lerTokensSessao(null)).toEqual({ ...TOKENS_ZERADOS, ultima_entrada: 0 })
    expect(lerTokensSessao({ input: '10', output: 3 })).toEqual({ ...TOKENS_ZERADOS, output: 3, ultima_entrada: 0 })
  })
})

describe('estimarProximaRodada', () => {
  it('na 1ª rodada estima por caracteres/4', () => {
    const e = estimarProximaRodada({ modelo: 'claude-sonnet-5', chars: 400_000, tokens: null, tokensSaida: 4_000 })
    expect(e.base).toBe('caracteres')
    expect(e.tokensEntrada).toBe(400_000 / CHARS_POR_TOKEN)
    expect(e.custoUsd).toBeGreaterThan(0)
  })

  it('depois da 1ª rodada usa o uso REAL da última (nunca abaixo da conta por chars)', () => {
    const e = estimarProximaRodada({
      modelo: 'claude-opus-5',
      chars: 40_000, // 10k tokens
      tokens: { input: 1, output: 1, cache_read: 0, cache_write: 0, ultima_entrada: 120_000 },
    })
    expect(e.base).toBe('ultima_rodada')
    expect(e.tokensEntrada).toBe(120_000)
  })

  it('a estimativa não desconta o cache — é o TETO da rodada', () => {
    const e = estimarProximaRodada({
      modelo: 'claude-opus-5',
      chars: 0,
      tokens: { input: 0, output: 0, cache_read: 0, cache_write: 0, ultima_entrada: 1_000_000 },
      tokensSaida: 0,
    })
    expect(e.custoUsd).toBeCloseTo(5, 6)
  })
})
