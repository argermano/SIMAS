import { describe, it, expect } from 'vitest'
import { calcularTaxaEdicao } from './taxa-edicao'

describe('calcularTaxaEdicao', () => {
  it('textos idênticos → 0', () => {
    expect(calcularTaxaEdicao('Excelentíssimo Senhor Doutor Juiz', 'Excelentíssimo Senhor Doutor Juiz')).toBe(0)
  })

  it('textos vazios → 0', () => {
    expect(calcularTaxaEdicao('', '')).toBe(0)
  })

  it('conteúdo totalmente diferente → 1', () => {
    expect(calcularTaxaEdicao('aposentadoria por invalidez', 'rescisão contrato trabalho')).toBe(1)
  })

  it('edição parcial fica entre 0 e 1', () => {
    const t = calcularTaxaEdicao('o autor requer a procedência do pedido', 'o autor requer a total procedência do pedido inicial')
    expect(t).toBeGreaterThan(0)
    expect(t).toBeLessThan(0.5)
  })

  it('ignora marcadores [PREENCHER]/[VERIFICAR] (não contam como edição)', () => {
    const t = calcularTaxaEdicao('vara de [PREENCHER] comarca', 'vara de São Paulo comarca')
    // Só a palavra "são paulo" foi adicionada; o marcador não penaliza.
    expect(t).toBeLessThan(0.4)
  })

  it('é simétrica o suficiente para o uso (ordem não muda muito)', () => {
    const a = calcularTaxaEdicao('alpha beta gama', 'gama beta alpha')
    expect(a).toBe(0) // mesmas palavras, ordem diferente → sem edição de conteúdo
  })
})
