import { describe, it, expect } from 'vitest'
import { cotacaoUsdBrl, formatarUsdEmReais, usdParaReais, USD_BRL_PADRAO } from './custo-brl'

describe('custo em reais', () => {
  it('usa 5,70 quando a cotação não está configurada', () => {
    expect(cotacaoUsdBrl()).toBe(USD_BRL_PADRAO)
  })

  it('converte e arredonda ao centavo', () => {
    expect(usdParaReais(1, 5.7)).toBe(5.7)
    expect(usdParaReais(0.1234, 5.7)).toBe(0.7)
  })

  it('nunca devolve valor negativo', () => {
    expect(usdParaReais(-3, 5.7)).toBe(0)
    expect(usdParaReais(Number.NaN, 5.7)).toBe(0)
  })

  it('formata em reais', () => {
    expect(formatarUsdEmReais(0.7368, 5.7)).toBe('R$ 4,20')
    expect(formatarUsdEmReais(0, 5.7)).toBe('R$ 0,00')
  })

  it('distingue "de graça" de "menos de um centavo"', () => {
    expect(formatarUsdEmReais(0.0001, 5.7)).toBe('< R$ 0,01')
  })
})
