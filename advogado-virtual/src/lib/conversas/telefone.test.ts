import { describe, it, expect } from 'vitest'
import { chaveTelefone, mesmoTelefone } from './telefone'

// Espelha os casos do matching da Fase 5 (by-phone), garantindo que o helper
// re-exportado para conversas se comporta exatamente como o canônico.

describe('chaveTelefone — chave de comparação por dígitos', () => {
  it('limpa máscara BR (11 dígitos: DDD + celular)', () => {
    expect(chaveTelefone('(47) 99118-6787')).toBe('47991186787')
    expect(chaveTelefone('479 9118-6787')).toBe('47991186787')
  })

  it('remove DDI 55 em 13 dígitos (DDI + DDD + 9 dígitos)', () => {
    expect(chaveTelefone('+5547991186787')).toBe('47991186787')
    expect(chaveTelefone('5547991186787')).toBe('47991186787')
  })

  it('remove DDI 55 em 12 dígitos (DDI + DDD + 8 dígitos)', () => {
    expect(chaveTelefone('+554733334444')).toBe('4733334444')
  })

  it('NÃO trata DDD 55 (RS) como DDI em 10/11 dígitos', () => {
    expect(chaveTelefone('55991186787')).toBe('55991186787')
    expect(chaveTelefone('5533334444')).toBe('5533334444')
  })

  it('vazio/null/sem dígitos → chave vazia', () => {
    expect(chaveTelefone('')).toBe('')
    expect(chaveTelefone(null)).toBe('')
    expect(chaveTelefone(undefined)).toBe('')
    expect(chaveTelefone('abc')).toBe('')
  })
})

describe('mesmoTelefone — mesma linha com máscara/DDI/9º dígito', () => {
  it('máscaras diferentes casam', () => {
    expect(mesmoTelefone('(47) 99118-6787', '+5547991186787')).toBe(true)
    expect(mesmoTelefone('47991186787', '4799118-6787')).toBe(true)
  })

  it('tolera presença/ausência do 9º dígito', () => {
    expect(mesmoTelefone('+5547991186787', '4791186787')).toBe(true)
  })

  it('E.164 do WhatsApp casa com o cadastro mascarado', () => {
    expect(mesmoTelefone('+55 47 3333-4444', '(47) 3333-4444')).toBe(true)
  })

  it('DDD 55 (RS) não cross-matcha com outro DDD', () => {
    expect(mesmoTelefone('55991186787', '47991186787')).toBe(false)
  })

  it('telefones diferentes NÃO casam', () => {
    expect(mesmoTelefone('47991186787', '11988887777')).toBe(false)
    expect(mesmoTelefone('', '47991186787')).toBe(false)
    expect(mesmoTelefone(null, '47991186787')).toBe(false)
  })
})
