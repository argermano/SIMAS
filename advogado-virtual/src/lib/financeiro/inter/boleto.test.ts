import { describe, expect, it } from 'vitest'
import {
  centavosParaReais,
  mapearSituacao,
  montarCorpoBolePix,
  normalizarBoleto,
  reaisParaCentavos,
  type EmitirBoletoInput,
} from './boleto'

const inputBase: EmitirBoletoInput = {
  seuNumero: 'parcela-42',
  valorCentavos: 123456,
  dataVencimentoISO: '2026-08-10',
  pagador: {
    cpfCnpj: '123.456.789-00',
    tipoPessoa: 'FISICA',
    nome: 'Fulano de Tal',
    endereco: 'Rua X, 100',
    cidade: 'Curitiba',
    uf: 'pr',
    cep: '80000-000',
  },
}

describe('conversão centavos <-> reais', () => {
  it('centavos -> reais (2 casas, number)', () => {
    expect(centavosParaReais(123456)).toBe(1234.56)
    expect(centavosParaReais(100)).toBe(1)
    expect(centavosParaReais(1)).toBe(0.01)
  })
  it('reais -> centavos aceita number', () => {
    expect(reaisParaCentavos(1234.56)).toBe(123456)
    expect(reaisParaCentavos(0.1)).toBe(10)
  })
  it('reais -> centavos aceita string US e BR', () => {
    expect(reaisParaCentavos('1234.56')).toBe(123456)
    expect(reaisParaCentavos('1.234,56')).toBe(123456) // milhar + decimal BR
    expect(reaisParaCentavos('12,34')).toBe(1234)
  })
  it('reais -> centavos: inválido/ausente -> undefined', () => {
    expect(reaisParaCentavos(undefined)).toBeUndefined()
    expect(reaisParaCentavos(null)).toBeUndefined()
    expect(reaisParaCentavos('abc')).toBeUndefined()
    expect(reaisParaCentavos('')).toBeUndefined()
  })
})

describe('montarCorpoBolePix (payload de emissão)', () => {
  it('monta o corpo com valorNominal em reais e pagador só com dígitos', () => {
    const corpo = montarCorpoBolePix(inputBase)
    expect(corpo).toMatchObject({
      seuNumero: 'parcela-42',
      valorNominal: 1234.56,
      dataVencimento: '2026-08-10',
      pagador: {
        cpfCnpj: '12345678900',
        tipoPessoa: 'FISICA',
        nome: 'Fulano de Tal',
        cidade: 'Curitiba',
        uf: 'PR', // uppercased
        cep: '80000000',
      },
    })
    // numDiasAgenda omitido quando não informado.
    expect('numDiasAgenda' in corpo).toBe(false)
  })

  it('inclui numDiasAgenda quando informado', () => {
    const corpo = montarCorpoBolePix({ ...inputBase, numDiasAgenda: 30 })
    expect(corpo.numDiasAgenda).toBe(30)
  })

  it('rejeita valorCentavos não-inteiro ou <= 0', () => {
    expect(() => montarCorpoBolePix({ ...inputBase, valorCentavos: 0 })).toThrow()
    expect(() => montarCorpoBolePix({ ...inputBase, valorCentavos: -5 })).toThrow()
    expect(() => montarCorpoBolePix({ ...inputBase, valorCentavos: 12.5 })).toThrow()
  })
})

describe('mapearSituacao (Inter -> enum interno estável)', () => {
  it('mapeia valores conhecidos', () => {
    expect(mapearSituacao('A_RECEBER')).toBe('a_receber')
    expect(mapearSituacao('ATRASADO')).toBe('atrasado')
    expect(mapearSituacao('RECEBIDO')).toBe('recebido')
    expect(mapearSituacao('MARCADO_RECEBIDO')).toBe('recebido')
    expect(mapearSituacao('CANCELADO')).toBe('cancelado')
    expect(mapearSituacao('EXPIRADO')).toBe('expirado')
    expect(mapearSituacao('PROTESTO')).toBe('protestado')
    expect(mapearSituacao('EM_PROCESSAMENTO')).toBe('em_processamento')
  })
  it('case-insensitive', () => {
    expect(mapearSituacao('recebido')).toBe('recebido')
  })
  it('desconhecido/ausente -> desconhecida', () => {
    expect(mapearSituacao('QUALQUER_NOVA')).toBe('desconhecida')
    expect(mapearSituacao(undefined)).toBe('desconhecida')
    expect(mapearSituacao(null)).toBe('desconhecida')
  })
})

describe('normalizarBoleto (parse defensivo de GET /cobrancas/{id})', () => {
  it('extrai situação + boleto + pix + valor em centavos', () => {
    const b = normalizarBoleto('uuid-1', {
      cobranca: { situacao: 'A_RECEBER', valorNominal: 1234.56 },
      boleto: { nossoNumero: '0001', linhaDigitavel: '00190...', codigoBarras: '00191...' },
      pix: { txid: 'abc', pixCopiaECola: '000201...' },
    })
    expect(b).toMatchObject({
      codigoSolicitacao: 'uuid-1',
      situacao: 'a_receber',
      situacaoInter: 'A_RECEBER',
      valorCentavos: 123456,
      nossoNumero: '0001',
      linhaDigitavel: '00190...',
      codigoBarras: '00191...',
      txid: 'abc',
      pixCopiaECola: '000201...',
    })
  })
  it('tolera boleto/pix ausentes (situação sem esses blocos)', () => {
    const b = normalizarBoleto('uuid-2', { cobranca: { situacao: 'CANCELADO' } })
    expect(b.situacao).toBe('cancelado')
    expect(b.nossoNumero).toBeUndefined()
    expect(b.pixCopiaECola).toBeUndefined()
    expect(b.valorCentavos).toBeUndefined()
  })
  it('tolera dados totalmente vazios', () => {
    const b = normalizarBoleto('uuid-3', undefined)
    expect(b.situacao).toBe('desconhecida')
    expect(b.codigoSolicitacao).toBe('uuid-3')
  })
})
