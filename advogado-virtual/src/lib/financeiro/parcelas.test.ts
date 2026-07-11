import { describe, it, expect } from 'vitest'
import { gerarSerie, proximosAvisos, formatarValor } from './parcelas'

describe('gerarSerie — divisão com resto na ÚLTIMA parcela (soma exata)', () => {
  it('R$ 1.000,00 em 3x: 333,33 + 333,33 + 333,34', () => {
    const serie = gerarSerie({
      valorTotalCentavos: 100000,
      numParcelas: 3,
      primeiroVencimento: '2026-08-10',
    })
    expect(serie.map((p) => p.valor_centavos)).toEqual([33333, 33333, 33334])
    expect(serie.reduce((s, p) => s + p.valor_centavos, 0)).toBe(100000)
    expect(serie.map((p) => p.vencimento)).toEqual(['2026-08-10', '2026-09-10', '2026-10-10'])
    expect(serie[1].descricao).toBe('Honorários — parcela 2/3')
  })

  it('com entrada: entrada no primeiro vencimento e parcelas a partir do mês seguinte', () => {
    const serie = gerarSerie({
      valorTotalCentavos: 100000,
      entradaCentavos: 40000,
      numParcelas: 2,
      primeiroVencimento: '2026-08-05',
    })
    expect(serie).toEqual([
      { descricao: 'Honorários — entrada', valor_centavos: 40000, vencimento: '2026-08-05' },
      { descricao: 'Honorários — parcela 1/2', valor_centavos: 30000, vencimento: '2026-09-05' },
      { descricao: 'Honorários — parcela 2/2', valor_centavos: 30000, vencimento: '2026-10-05' },
    ])
  })

  it('diaFixo: vencimentos seguintes no dia fixo, com clamp no fim do mês (31 → fev)', () => {
    const serie = gerarSerie({
      valorTotalCentavos: 30000,
      numParcelas: 3,
      primeiroVencimento: '2026-12-31',
      diaFixo: 31,
    })
    expect(serie.map((p) => p.vencimento)).toEqual(['2026-12-31', '2027-01-31', '2027-02-28'])
  })

  it('sem diaFixo, dia 31 clampa em meses de 30 dias e vira o ano', () => {
    const serie = gerarSerie({
      valorTotalCentavos: 20000,
      numParcelas: 2,
      primeiroVencimento: '2026-10-31',
    })
    expect(serie.map((p) => p.vencimento)).toEqual(['2026-10-31', '2026-11-30'])
  })

  it('parcela única sem resto', () => {
    const serie = gerarSerie({
      valorTotalCentavos: 12345,
      numParcelas: 1,
      primeiroVencimento: '2026-08-01',
    })
    expect(serie).toEqual([
      { descricao: 'Honorários — parcela 1/1', valor_centavos: 12345, vencimento: '2026-08-01' },
    ])
  })

  it('validações: total <= 0, parcelas < 1, entrada >= total, data inválida', () => {
    expect(() => gerarSerie({ valorTotalCentavos: 0, numParcelas: 1, primeiroVencimento: '2026-08-01' })).toThrow()
    expect(() => gerarSerie({ valorTotalCentavos: 100, numParcelas: 0, primeiroVencimento: '2026-08-01' })).toThrow()
    expect(() =>
      gerarSerie({ valorTotalCentavos: 100, entradaCentavos: 100, numParcelas: 1, primeiroVencimento: '2026-08-01' }),
    ).toThrow()
    expect(() => gerarSerie({ valorTotalCentavos: 100, numParcelas: 1, primeiroVencimento: '01/08/2026' })).toThrow()
  })
})

describe('proximosAvisos — hoje+3 (d3) e hoje (d0), nunca vencidas', () => {
  const parcelas = [
    { id: 'vencida', vencimento: '2026-07-10', status: 'aberta' },
    { id: 'hoje', vencimento: '2026-07-11', status: 'aberta' },
    { id: 'd2', vencimento: '2026-07-13', status: 'aberta' },
    { id: 'd3', vencimento: '2026-07-14', status: 'aberta' },
    { id: 'd3-paga', vencimento: '2026-07-14', status: 'paga' },
    { id: 'longe', vencimento: '2026-08-14', status: 'aberta' },
  ]
  it('separa d3 e d0 por igualdade exata de data', () => {
    const { d3, d0 } = proximosAvisos(parcelas, '2026-07-11')
    expect(d3.map((p) => p.id)).toEqual(['d3'])
    expect(d0.map((p) => p.id)).toEqual(['hoje'])
  })
  it('vencidas NUNCA entram (invariante dura)', () => {
    const { d3, d0 } = proximosAvisos(parcelas, '2026-07-20')
    expect(d3).toEqual([])
    expect(d0).toEqual([])
  })
  it('d3 atravessa borda de mês', () => {
    const { d3 } = proximosAvisos([{ vencimento: '2026-08-02' }], '2026-07-30')
    expect(d3.length).toBe(1)
  })
})

describe('formatarValor — centavos → R$ na borda', () => {
  it('123456 → R$ 1.234,56', () => expect(formatarValor(123456)).toBe('R$ 1.234,56'))
  it('5 → R$ 0,05', () => expect(formatarValor(5)).toBe('R$ 0,05'))
  it('100 → R$ 1,00', () => expect(formatarValor(100)).toBe('R$ 1,00'))
  it('123456789 → R$ 1.234.567,89', () => expect(formatarValor(123456789)).toBe('R$ 1.234.567,89'))
  it('negativo → -R$ 1,00', () => expect(formatarValor(-100)).toBe('-R$ 1,00'))
})
