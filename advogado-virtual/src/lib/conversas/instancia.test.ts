import { describe, it, expect } from 'vitest'
import { instanciaDaUnidade, rotuloInstancia, ROTULO_INSTANCIA, OPCOES_INSTANCIA } from './instancia'

// Mapeamento PURO da unidade → instância de saída do WhatsApp. Testável sem rede.
describe('instanciaDaUnidade — número de saída por unidade', () => {
  it('brasília sai pelo número DF', () => {
    expect(instanciaDaUnidade('brasilia')).toBe('whatsapp-df')
  })

  it('florianópolis e blumenau saem pelo número SC', () => {
    expect(instanciaDaUnidade('florianopolis')).toBe('whatsapp-sc')
    expect(instanciaDaUnidade('blumenau')).toBe('whatsapp-sc')
  })

  it('sem unidade (null/undefined) → null (roteia pelo DDD)', () => {
    expect(instanciaDaUnidade(null)).toBeNull()
    expect(instanciaDaUnidade(undefined)).toBeNull()
  })

  it('valor fora do CHECK → null (defesa em profundidade)', () => {
    expect(instanciaDaUnidade('curitiba')).toBeNull()
    expect(instanciaDaUnidade('')).toBeNull()
  })
})

describe('rotuloInstancia — texto para a UI', () => {
  it('rotula cada instância', () => {
    expect(rotuloInstancia('whatsapp-sc')).toBe(ROTULO_INSTANCIA['whatsapp-sc'])
    expect(rotuloInstancia('whatsapp-df')).toBe(ROTULO_INSTANCIA['whatsapp-df'])
  })

  it('null → automático pelo DDD', () => {
    expect(rotuloInstancia(null)).toMatch(/autom/i)
  })
})

describe('OPCOES_INSTANCIA — opções do select', () => {
  it('primeira opção é o automático (value vazio)', () => {
    expect(OPCOES_INSTANCIA[0].value).toBe('')
  })

  it('cobre as duas instâncias', () => {
    const valores = OPCOES_INSTANCIA.map((o) => o.value)
    expect(valores).toContain('whatsapp-sc')
    expect(valores).toContain('whatsapp-df')
  })
})
