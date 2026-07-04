import { describe, it, expect } from 'vitest'
import { similaridadeTexto } from './similaridade'

describe('similaridadeTexto (dedup de teses)', () => {
  it('textos idênticos → 1', () => {
    expect(similaridadeTexto('tempo especial por ruído', 'tempo especial por ruído')).toBe(1)
  })

  it('teses equivalentes (reordenadas/pequena variação) ficam altas', () => {
    const a = 'O tempo de exposição a ruído acima do limite é computado como especial'
    const b = 'Tempo de exposição a ruído acima do limite legal computado como especial'
    expect(similaridadeTexto(a, b)).toBeGreaterThan(0.75)
  })

  it('teses de assuntos diferentes ficam baixas', () => {
    expect(similaridadeTexto('aposentadoria por invalidez', 'rescisão indireta do contrato de trabalho')).toBeLessThan(0.3)
  })

  it('vazio vs vazio → 1; algo vs vazio → 0', () => {
    expect(similaridadeTexto('', '')).toBe(1)
    expect(similaridadeTexto('algo', '')).toBe(0)
  })
})
