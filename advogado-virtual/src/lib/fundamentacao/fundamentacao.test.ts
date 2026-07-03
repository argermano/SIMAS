import { describe, it, expect } from 'vitest'
import { tesesDaArea, tesesDaAreaComExemplos, blocoFundamentacaoParaPrompt } from './index'

describe('base curada de fundamentação', () => {
  it('exclui registros de EXEMPLO das teses reais', () => {
    // previdenciario tem 1 exemplo (template) — não deve entrar nas reais.
    expect(tesesDaArea('previdenciario')).toHaveLength(0)
    expect(tesesDaAreaComExemplos('previdenciario').some((t) => t.exemplo)).toBe(true)
  })

  it('NÃO injeta bloco de fundamentação quando a área não tem tese real', () => {
    // Garante que o template/exemplo nunca vaza para o prompt de geração.
    expect(blocoFundamentacaoParaPrompt('previdenciario')).toBe('')
    expect(blocoFundamentacaoParaPrompt('civel')).toBe('')
    expect(blocoFundamentacaoParaPrompt('area_inexistente')).toBe('')
  })
})
