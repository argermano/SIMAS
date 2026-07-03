import { describe, it, expect } from 'vitest'
import { validarNumeroCNJ, verificarCitacoes } from './verificador-citacoes'

/** Resto mod 97 dígito-a-dígito (mesma técnica do módulo, sem BigInt). */
function restoMod97(s: string): number {
  let r = 0
  for (let i = 0; i < s.length; i++) r = (r * 10 + (s.charCodeAt(i) - 48)) % 97
  return r
}

/**
 * Gera um nº CNJ com dígito verificador CORRETO pela fórmula canônica
 * (DV = 98 - (base·100 mod 97)) — independente da forma usada no validador
 * (rearranjo ≡ 1 mod 97), servindo de cross-check da equivalência.
 */
function numeroCNJValido(seq: string, ano: string, jtr: string, orig: string): string {
  const dv = (98 - restoMod97(seq + ano + jtr + orig + '00')).toString().padStart(2, '0')
  return `${seq}-${dv}.${ano}.${jtr[0]}.${jtr.slice(1)}.${orig}`
}

describe('validarNumeroCNJ', () => {
  it('aceita um número com dígito verificador correto', () => {
    expect(validarNumeroCNJ(numeroCNJValido('0001234', '2020', '403', '7000'))).toBe(true)
    expect(validarNumeroCNJ(numeroCNJValido('5001234', '2019', '826', '0001'))).toBe(true)
  })

  it('rejeita quando um dígito é adulterado (número inventado)', () => {
    const valido = numeroCNJValido('0001234', '2020', '403', '7000')
    // troca o primeiro dígito do sequencial
    const adulterado = (valido[0] === '9' ? '8' : '9') + valido.slice(1)
    expect(validarNumeroCNJ(adulterado)).toBe(false)
  })

  it('rejeita formato/tamanho inválido', () => {
    expect(validarNumeroCNJ('123')).toBe(false)
    expect(validarNumeroCNJ('não é um processo')).toBe(false)
    expect(validarNumeroCNJ('')).toBe(false)
  })
})

describe('verificarCitacoes — leis', () => {
  it('reconhece um diploma conhecido', () => {
    const r = verificarCitacoes('Nos termos da Lei nº 8.213/1991, o benefício é devido.')
    const lei = r.itens.find((i) => i.tipo === 'lei')
    expect(lei?.status).toBe('verificada')
  })

  it('reconhece CLT via Decreto-Lei 5.452/1943', () => {
    const r = verificarCitacoes('Conforme o Decreto-Lei 5.452/1943 (CLT).')
    expect(r.itens.some((i) => i.tipo === 'lei' && i.status === 'verificada')).toBe(true)
  })

  it('aceita ano com 2 dígitos', () => {
    const r = verificarCitacoes('Art. 100 da Lei 8.078/90.')
    expect(r.itens.some((i) => i.tipo === 'lei' && i.status === 'verificada')).toBe(true)
  })

  it('marca "conferir" para lei fora da base local', () => {
    const r = verificarCitacoes('Aplica-se a Lei nº 99.999/2050 ao caso.')
    const lei = r.itens.find((i) => i.tipo === 'lei')
    expect(lei?.status).toBe('conferir')
  })
})

describe('verificarCitacoes — súmulas', () => {
  it('verifica súmula dentro da faixa', () => {
    const r = verificarCitacoes('Súmula 7 do STJ veda o reexame de provas.')
    const s = r.itens.find((i) => i.tipo === 'sumula')
    expect(s?.status).toBe('verificada')
  })

  it('flagra súmula muito acima do último número conhecido', () => {
    const r = verificarCitacoes('Conforme a Súmula 9999 do STJ.')
    const s = r.itens.find((i) => i.tipo === 'sumula')
    expect(s?.status).toBe('nao_verificada')
  })

  it('reconhece súmula vinculante', () => {
    const r = verificarCitacoes('A Súmula Vinculante 10 do STF é clara.')
    const s = r.itens.find((i) => i.tipo === 'sumula')
    expect(s?.texto).toBe('Súmula Vinculante 10')
    expect(s?.status).toBe('verificada')
  })
})

describe('verificarCitacoes — processos', () => {
  it('verifica nº CNJ válido e flagra inventado', () => {
    const valido = numeroCNJValido('0001234', '2021', '403', '7100')
    const inventado = '1234567-89.2021.4.03.7100' // dígitos arbitrários
    const r = verificarCitacoes(`Vide ${valido}. Cf. ainda ${inventado}.`)
    const procs = r.itens.filter((i) => i.tipo === 'processo')
    expect(procs.find((p) => p.texto === valido)?.status).toBe('verificada')
    expect(procs.find((p) => p.texto === inventado)?.status).toBe('nao_verificada')
  })
})

describe('verificarCitacoes — agregação', () => {
  it('deduplica citações repetidas', () => {
    const r = verificarCitacoes('Lei 8.213/1991 ... e novamente a Lei nº 8.213/1991.')
    expect(r.itens.filter((i) => i.tipo === 'lei').length).toBe(1)
  })

  it('conta verificadas, a conferir e problemas', () => {
    const r = verificarCitacoes('Lei 8.213/1991, Lei 99.999/2050 e Súmula 9999 do STJ.')
    expect(r.total).toBe(3)
    expect(r.verificadas).toBe(1)
    expect(r.aConferir).toBe(1)
    expect(r.problemas).toBe(1)
  })

  it('texto vazio retorna relatório zerado', () => {
    const r = verificarCitacoes('')
    expect(r).toEqual({ itens: [], total: 0, verificadas: 0, aConferir: 0, problemas: 0 })
  })
})
