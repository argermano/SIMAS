import { describe, it, expect } from 'vitest'
import {
  decidirPrevisao,
  montarDescricaoPrevisao,
  type ContratoPrevisao,
  type EstadoPrevisao,
} from './previsao'

// Contrato "saudável" base (valor fixo, cliente, ativo). Cada teste sobrescreve.
const contratoOk = (over: Partial<ContratoPrevisao> = {}): ContratoPrevisao => ({
  valor_fixo: 1500,
  cliente_id: 'cli-1',
  status: 'assinado',
  deleted_at: null,
  titulo: 'Ação trabalhista',
  forma_pagamento: null,
  ...over,
})

const estado = (over: Partial<EstadoPrevisao> = {}): EstadoPrevisao => ({
  contrato: contratoOk(),
  temParcelasReais: false,
  previsaoExistente: null,
  ...over,
})

describe('montarDescricaoPrevisao', () => {
  it('usa o título do contrato', () => {
    expect(montarDescricaoPrevisao('Ação X', null)).toBe('Previsão de recebimento — contrato Ação X')
  })

  it('anexa a forma de pagamento quando há texto', () => {
    expect(montarDescricaoPrevisao('Ação X', 'Pix em 3x')).toBe(
      'Previsão de recebimento — contrato Ação X (forma: Pix em 3x)',
    )
  })

  it('cai para "sem título" quando o título é vazio/nulo', () => {
    expect(montarDescricaoPrevisao(null, null)).toBe('Previsão de recebimento — contrato sem título')
    expect(montarDescricaoPrevisao('   ', '  ')).toBe('Previsão de recebimento — contrato sem título')
  })
})

describe('decidirPrevisao', () => {
  it('cria a previsão (valor em CENTAVOS) quando o contrato tem valor fixo e cliente e não há parcela real', () => {
    const acao = decidirPrevisao(estado())
    expect(acao).toEqual({
      tipo: 'criar',
      valorCentavos: 150000,
      descricao: 'Previsão de recebimento — contrato Ação trabalhista',
    })
  })

  it('converte reais decimais para centavos com arredondamento', () => {
    const acao = decidirPrevisao(estado({ contrato: contratoOk({ valor_fixo: 1500.5 }) }))
    expect(acao).toMatchObject({ tipo: 'criar', valorCentavos: 150050 })
  })

  it('não faz nada quando a previsão já bate valor e descrição', () => {
    const acao = decidirPrevisao(
      estado({ previsaoExistente: { id: 'p1', valor_centavos: 150000, descricao: 'Previsão de recebimento — contrato Ação trabalhista' } }),
    )
    expect(acao).toEqual({ tipo: 'nenhuma' })
  })

  it('atualiza quando o valor do contrato muda', () => {
    const acao = decidirPrevisao(
      estado({
        contrato: contratoOk({ valor_fixo: 2000 }),
        previsaoExistente: { id: 'p1', valor_centavos: 150000, descricao: 'Previsão de recebimento — contrato Ação trabalhista' },
      }),
    )
    expect(acao).toEqual({ tipo: 'atualizar', id: 'p1', valorCentavos: 200000, descricao: 'Previsão de recebimento — contrato Ação trabalhista' })
  })

  it('atualiza quando a forma de pagamento (descrição) muda', () => {
    const acao = decidirPrevisao(
      estado({
        contrato: contratoOk({ forma_pagamento: 'Boleto' }),
        previsaoExistente: { id: 'p1', valor_centavos: 150000, descricao: 'Previsão de recebimento — contrato Ação trabalhista' },
      }),
    )
    expect(acao).toMatchObject({ tipo: 'atualizar', id: 'p1', descricao: 'Previsão de recebimento — contrato Ação trabalhista (forma: Boleto)' })
  })

  it('remove a previsão quando já existem parcelas REAIS do contrato (série substitui)', () => {
    const acao = decidirPrevisao(
      estado({ temParcelasReais: true, previsaoExistente: { id: 'p1', valor_centavos: 150000, descricao: 'x' } }),
    )
    expect(acao).toEqual({ tipo: 'remover', id: 'p1' })
  })

  it('remove a previsão quando o valor zera', () => {
    for (const valor of [0, null]) {
      const acao = decidirPrevisao(
        estado({ contrato: contratoOk({ valor_fixo: valor }), previsaoExistente: { id: 'p1', valor_centavos: 1, descricao: 'x' } }),
      )
      expect(acao).toEqual({ tipo: 'remover', id: 'p1' })
    }
  })

  it('remove a previsão quando o contrato foi excluído (deleted_at) ou não existe', () => {
    expect(decidirPrevisao(estado({ contrato: contratoOk({ deleted_at: '2026-07-16T00:00:00Z' }), previsaoExistente: { id: 'p1', valor_centavos: 1, descricao: 'x' } })))
      .toEqual({ tipo: 'remover', id: 'p1' })
    expect(decidirPrevisao(estado({ contrato: null, previsaoExistente: { id: 'p1', valor_centavos: 1, descricao: 'x' } })))
      .toEqual({ tipo: 'remover', id: 'p1' })
  })

  it('remove a previsão quando o contrato está cancelado', () => {
    const acao = decidirPrevisao(
      estado({ contrato: contratoOk({ status: 'cancelado' }), previsaoExistente: { id: 'p1', valor_centavos: 1, descricao: 'x' } }),
    )
    expect(acao).toEqual({ tipo: 'remover', id: 'p1' })
  })

  it('não cria previsão para contrato sem cliente (parcela exige cliente_id)', () => {
    expect(decidirPrevisao(estado({ contrato: contratoOk({ cliente_id: null }) }))).toEqual({ tipo: 'nenhuma' })
  })

  it('nada a fazer quando não deve existir e não há previsão', () => {
    expect(decidirPrevisao(estado({ temParcelasReais: true }))).toEqual({ tipo: 'nenhuma' })
    expect(decidirPrevisao(estado({ contrato: null }))).toEqual({ tipo: 'nenhuma' })
  })
})
