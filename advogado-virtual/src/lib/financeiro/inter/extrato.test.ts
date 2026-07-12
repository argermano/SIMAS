import { describe, expect, it } from 'vitest'
import { casarComprovante, normalizarExtrato, type LancamentoPix } from './extrato'

describe('normalizarExtrato (parse defensivo)', () => {
  it('mantém só Pix com e2e + data; converte valor (número) para centavos', () => {
    const lancs = normalizarExtrato({
      transacoes: [
        {
          tipoTransacao: 'PIX',
          valor: 78.9,
          dataEntrada: '2026-08-01',
          detalhes: { endToEndId: 'E001', nomePagador: 'João', cpfCnpjPagador: '123.456.789-00' },
        },
        // não-Pix é ignorado
        { tipoTransacao: 'BOLETO_COBRANCA', valor: 10, dataEntrada: '2026-08-01' },
        // Pix sem e2e é ignorado (não dá para conciliar)
        { tipoTransacao: 'PIX', valor: 5, dataEntrada: '2026-08-02', detalhes: {} },
      ],
    })
    expect(lancs).toHaveLength(1)
    expect(lancs[0]).toEqual({
      endToEndId: 'E001',
      valorCentavos: 7890,
      dataISO: '2026-08-01',
      cpfCnpjPagador: '12345678900', // só dígitos
      nomePagador: 'João',
    })
  })

  it('valor como string com vírgula e data-hora; campos opcionais ausentes', () => {
    const lancs = normalizarExtrato({
      transacoes: [
        {
          tipoTransacao: 'PIX',
          valor: '1.234,56',
          dataInclusao: '2026-08-05T13:45:00', // sem dataEntrada -> usa dataInclusao, corta a hora
          detalhes: { endToEndId: 'E002' }, // sem nome/cpf
        },
      ],
    })
    expect(lancs).toEqual([{ endToEndId: 'E002', valorCentavos: 123456, dataISO: '2026-08-05' }])
  })

  it('tolera envelope alternativo e ausência de transações', () => {
    expect(normalizarExtrato(undefined)).toEqual([])
    expect(normalizarExtrato({})).toEqual([])
    const arr = normalizarExtrato([
      { tipoTransacao: 'PIX', valor: 1, dataEntrada: '2026-01-01', detalhes: { endToEndId: 'E' } },
    ])
    expect(arr).toHaveLength(1)
  })
})

describe('casarComprovante', () => {
  const lancs: LancamentoPix[] = [
    { endToEndId: 'E100', valorCentavos: 10000, dataISO: '2026-08-01', cpfCnpjPagador: '11111111111', nomePagador: 'A' },
    { endToEndId: 'E200', valorCentavos: 25000, dataISO: '2026-08-02', cpfCnpjPagador: '22222222222', nomePagador: 'B' },
  ]

  it('casa por e2e exato (critério primário)', () => {
    const r = casarComprovante({ endToEndId: 'E200', valorCentavos: 999, dataISO: '2000-01-01' }, lancs)
    expect(r).toMatchObject({ casou: true, criterio: 'e2e' })
    expect(r.lancamento?.endToEndId).toBe('E200')
  })

  it('fallback por valor + dia + cpf quando o e2e não bate', () => {
    const r = casarComprovante(
      { endToEndId: 'E999', valorCentavos: 10000, dataISO: '2026-08-01', cpfCnpj: '111.111.111-11' },
      lancs,
    )
    expect(r).toMatchObject({ casou: true, criterio: 'valor_data_cpf' })
    expect(r.lancamento?.endToEndId).toBe('E100')
  })

  it('fallback sem cpf informado: casa por valor + dia', () => {
    const r = casarComprovante({ valorCentavos: 25000, dataISO: '2026-08-02' }, lancs)
    expect(r).toMatchObject({ casou: true, criterio: 'valor_data_cpf' })
    expect(r.lancamento?.endToEndId).toBe('E200')
  })

  it('nunca casa valor diferente', () => {
    const r = casarComprovante({ valorCentavos: 9999, dataISO: '2026-08-01' }, lancs)
    expect(r).toEqual({ casou: false, criterio: 'nenhum' })
  })

  it('valor+dia certos mas cpf diferente NÃO casa', () => {
    const r = casarComprovante(
      { valorCentavos: 10000, dataISO: '2026-08-01', cpfCnpj: '99999999999' },
      lancs,
    )
    expect(r.casou).toBe(false)
  })

  it('dia diferente NÃO casa (mesmo valor)', () => {
    const r = casarComprovante({ valorCentavos: 10000, dataISO: '2026-08-09' }, lancs)
    expect(r.casou).toBe(false)
  })

  it('lista vazia -> nenhum', () => {
    expect(casarComprovante({ endToEndId: 'E1', valorCentavos: 1, dataISO: '2026-01-01' }, [])).toEqual({
      casou: false,
      criterio: 'nenhum',
    })
  })
})
