import { describe, it, expect } from 'vitest'
import {
  PRECOS_MTOK,
  PRECO_PADRAO_MTOK,
  MULT_CACHE_LEITURA,
  MULT_CACHE_ESCRITA_1H,
  precoDe,
  custoEstimadoUSD,
} from './usage'

// Datas fixas (UTC) para não depender do relógio da máquina.
const DENTRO_DO_INTRO = new Date('2026-08-31T23:00:00.000Z')
const DEPOIS_DO_INTRO = new Date('2026-09-01T00:00:00.000Z')

describe('PRECOS_MTOK — tabela de preços por milhão de tokens', () => {
  it('tem os modelos do plano com os valores oficiais', () => {
    expect(PRECOS_MTOK['claude-opus-5']).toEqual({ input: 5, output: 25 })
    expect(PRECOS_MTOK['claude-opus-4-8']).toEqual({ input: 5, output: 25 })
    expect(PRECOS_MTOK['claude-opus-4-7']).toEqual({ input: 5, output: 25 })
    expect(PRECOS_MTOK['claude-fable-5']).toEqual({ input: 10, output: 50 })
    expect(PRECOS_MTOK['claude-sonnet-4-6']).toEqual({ input: 3, output: 15 })
    expect(PRECOS_MTOK['claude-haiku-4-5']).toEqual({ input: 1, output: 5 })
    expect(PRECOS_MTOK['claude-sonnet-5'].input).toBe(3)
    expect(PRECOS_MTOK['claude-sonnet-5'].output).toBe(15)
  })
})

describe('precoDe', () => {
  it('casa por prefixo, tolerando sufixo de data', () => {
    expect(precoDe('claude-haiku-4-5-20251001')).toEqual({ input: 1, output: 5 })
    expect(precoDe('claude-opus-4-8-20260101')).toEqual({ input: 5, output: 25 })
  })

  it('não confunde opus-5 com opus-4-8 nem sonnet-5 com sonnet-4-6', () => {
    expect(precoDe('claude-opus-5')).toEqual({ input: 5, output: 25 })
    expect(precoDe('claude-sonnet-4-6', DENTRO_DO_INTRO)).toEqual({ input: 3, output: 15 })
  })

  it('aplica o preço de introdução do Sonnet 5 até 31/08/2026 inclusive', () => {
    expect(precoDe('claude-sonnet-5', DENTRO_DO_INTRO)).toEqual({ input: 2, output: 10 })
  })

  it('volta ao preço cheio do Sonnet 5 a partir de 01/09/2026', () => {
    expect(precoDe('claude-sonnet-5', DEPOIS_DO_INTRO)).toEqual({ input: 3, output: 15 })
  })

  it('cai no fallback (Sonnet) para modelo desconhecido', () => {
    expect(precoDe('modelo-que-nao-existe')).toEqual({
      input: PRECO_PADRAO_MTOK.input,
      output: PRECO_PADRAO_MTOK.output,
    })
    expect(precoDe('')).toEqual({ input: PRECO_PADRAO_MTOK.input, output: PRECO_PADRAO_MTOK.output })
  })
})

describe('custoEstimadoUSD', () => {
  it('soma input e output pelo preço do modelo', () => {
    // 1M input + 1M output em Opus = 5 + 25
    expect(custoEstimadoUSD({ modelo: 'claude-opus-5', tokensInput: 1_000_000, tokensOutput: 1_000_000 }))
      .toBeCloseTo(30, 10)
  })

  it('cobra leitura de cache a 0,1x do input e escrita (1h) a 2x', () => {
    const custo = custoEstimadoUSD({
      modelo: 'claude-opus-5',
      tokensInput: 0,
      tokensOutput: 0,
      tokensCacheRead: 1_000_000,
      tokensCacheWrite: 1_000_000,
    })
    expect(custo).toBeCloseTo(5 * MULT_CACHE_LEITURA + 5 * MULT_CACHE_ESCRITA_1H, 10)
  })

  it('a rodada em cache custa MENOS que a mesma entrada sem cache', () => {
    const semCache = custoEstimadoUSD({ modelo: 'claude-opus-5', tokensInput: 200_000, tokensOutput: 2_000 })
    const comCache = custoEstimadoUSD({
      modelo: 'claude-opus-5',
      tokensInput: 0,
      tokensOutput: 2_000,
      tokensCacheRead: 200_000,
    })
    expect(comCache).toBeLessThan(semCache)
  })

  it('usa o preço de introdução do Sonnet 5 quando a data está na vigência', () => {
    const intro = custoEstimadoUSD({
      modelo: 'claude-sonnet-5', tokensInput: 1_000_000, tokensOutput: 0, quando: DENTRO_DO_INTRO,
    })
    const cheio = custoEstimadoUSD({
      modelo: 'claude-sonnet-5', tokensInput: 1_000_000, tokensOutput: 0, quando: DEPOIS_DO_INTRO,
    })
    expect(intro).toBeCloseTo(2, 10)
    expect(cheio).toBeCloseTo(3, 10)
  })

  it('ignora contagens ausentes ou negativas (nunca gera custo negativo)', () => {
    expect(custoEstimadoUSD({ modelo: 'claude-opus-5', tokensInput: 0, tokensOutput: 0 })).toBe(0)
    expect(custoEstimadoUSD({ modelo: 'claude-opus-5', tokensInput: -5, tokensOutput: -5 })).toBe(0)
  })
})
