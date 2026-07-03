import { describe, it, expect } from 'vitest'
import { validarNumeroCNJ, verificarCitacoes, urnLexmlDaLei, aliasDataJud } from './verificador-citacoes'

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

describe('urnLexmlDaLei', () => {
  it('constrói a URN federal por tipo de diploma', () => {
    expect(urnLexmlDaLei('Lei 8.213/1991')).toBe('urn:lex:br:federal:lei:1991;8213')
    expect(urnLexmlDaLei('Lei Complementar 123/2006')).toBe('urn:lex:br:federal:lei.complementar:2006;123')
    expect(urnLexmlDaLei('Decreto-Lei 5.452/1943')).toBe('urn:lex:br:federal:decreto.lei:1943;5452')
    expect(urnLexmlDaLei('Emenda Constitucional 103/2019')).toBe('urn:lex:br:federal:emenda.constitucional:2019;103')
  })

  it('completa ano de 2 dígitos', () => {
    expect(urnLexmlDaLei('Lei nº 8.078/90')).toBe('urn:lex:br:federal:lei:1990;8078')
  })

  it('retorna null quando não é uma norma', () => {
    expect(urnLexmlDaLei('Súmula 7 do STJ')).toBeNull()
  })
})

describe('aliasDataJud', () => {
  // Monta um nº CNJ (20 díg.) com segmento J e tribunal TR nas posições certas.
  const mk = (j: string, tr: string) => `1234567` + `00` + `2023` + j + tr + `0000`

  it('deriva o alias por segmento e tribunal', () => {
    expect(aliasDataJud('50023017520234047210')).toBe('trf4') // J=4, TR=04
    expect(aliasDataJud(mk('3', '00'))).toBe('stj')            // Superior
    expect(aliasDataJud(mk('5', '00'))).toBe('tst')            // Trabalho superior
    expect(aliasDataJud(mk('5', '02'))).toBe('trt2')           // TRT 2ª
    expect(aliasDataJud(mk('4', '01'))).toBe('trf1')           // TRF 1ª
    expect(aliasDataJud(mk('8', '26'))).toBe('tjsp')           // Estadual SP
    expect(aliasDataJud(mk('8', '13'))).toBe('tjmg')           // Estadual MG
  })

  it('retorna null fora de cobertura (STF/eleitoral/militar) ou formato inválido', () => {
    expect(aliasDataJud(mk('1', '00'))).toBeNull() // STF não está no DataJud público
    expect(aliasDataJud(mk('6', '01'))).toBeNull() // eleitoral
    expect(aliasDataJud('123')).toBeNull()
  })
})
