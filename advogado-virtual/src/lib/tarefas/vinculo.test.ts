import { describe, it, expect } from 'vitest'
import {
  vinculoParaColunas,
  colunasParaVinculo,
  formatarCnj,
  formatarCpf,
  rotularArea,
  sublabelCliente,
  ehVinculoTipo,
  resolverVinculoView,
  COLUNA_POR_TIPO,
} from './vinculo'

describe('vinculoParaColunas', () => {
  it('zera tudo quando não há vínculo', () => {
    expect(vinculoParaColunas(null)).toEqual({ cliente_id: null, process_id: null, processo_id: null })
  })
  it('preenche só a coluna do tipo', () => {
    expect(vinculoParaColunas({ tipo: 'cliente', id: 'c1' })).toEqual({ cliente_id: 'c1', process_id: null, processo_id: null })
    expect(vinculoParaColunas({ tipo: 'atendimento', id: 'a1' })).toEqual({ cliente_id: null, process_id: 'a1', processo_id: null })
    expect(vinculoParaColunas({ tipo: 'processo', id: 'p1' })).toEqual({ cliente_id: null, process_id: null, processo_id: 'p1' })
  })
})

describe('colunasParaVinculo', () => {
  it('devolve null sem colunas', () => {
    expect(colunasParaVinculo({})).toBeNull()
  })
  it('mapeia cada coluna ao seu tipo', () => {
    expect(colunasParaVinculo({ cliente_id: 'c1' })).toEqual({ tipo: 'cliente', id: 'c1' })
    expect(colunasParaVinculo({ process_id: 'a1' })).toEqual({ tipo: 'atendimento', id: 'a1' })
    expect(colunasParaVinculo({ processo_id: 'p1' })).toEqual({ tipo: 'processo', id: 'p1' })
  })
  it('faz roundtrip com vinculoParaColunas', () => {
    for (const v of [
      { tipo: 'cliente', id: 'c1' },
      { tipo: 'atendimento', id: 'a1' },
      { tipo: 'processo', id: 'p1' },
    ] as const) {
      expect(colunasParaVinculo(vinculoParaColunas(v))).toEqual(v)
    }
  })
})

describe('formatarCnj', () => {
  it('mascara 20 dígitos', () => {
    expect(formatarCnj('00008323420184013300')).toBe('0000832-34.2018.4.01.3300')
  })
  it('devolve cru quando não são 20 dígitos', () => {
    expect(formatarCnj('123')).toBe('123')
    expect(formatarCnj(null)).toBe('')
  })
})

describe('formatarCpf', () => {
  it('mascara 11 dígitos', () => {
    expect(formatarCpf('12345678901')).toBe('123.456.789-01')
  })
  it('cru/trim quando não são 11 dígitos, null se vazio', () => {
    expect(formatarCpf('abc')).toBe('abc')
    expect(formatarCpf('  ')).toBeNull()
    expect(formatarCpf(null)).toBeNull()
  })
})

describe('rotularArea', () => {
  it('usa o nome amigável de áreas conhecidas', () => {
    expect(rotularArea('previdenciario')).toBe('Previdenciário')
  })
  it('capitaliza áreas desconhecidas e cai em Caso quando vazio', () => {
    expect(rotularArea('xpto')).toBe('Xpto')
    expect(rotularArea('')).toBe('Caso')
    expect(rotularArea(null)).toBe('Caso')
  })
})

describe('sublabelCliente', () => {
  it('prefere CPF, cai no telefone, senão null', () => {
    expect(sublabelCliente('12345678901', '4199999')).toBe('123.456.789-01')
    expect(sublabelCliente(null, '4199999')).toBe('4199999')
    expect(sublabelCliente(null, null)).toBeNull()
  })
})

describe('resolverVinculoView', () => {
  it('null sem vínculo', () => {
    expect(resolverVinculoView({})).toBeNull()
  })
  it('cliente: label=nome, href para /clientes', () => {
    expect(resolverVinculoView({ cliente_id: 'c1', cliente: { id: 'c1', nome: 'Maria' } })).toEqual({
      tipo: 'cliente', id: 'c1', label: 'Maria', sublabel: null, href: '/clientes/c1', removido: false,
    })
  })
  it('atendimento: área + sublabel cliente·nº, href do caso', () => {
    const v = resolverVinculoView({
      process_id: 'a1',
      atendimentos: { id: 'a1', area: 'previdenciario', numero_processo: '0001', clientes: { id: 'c9', nome: 'João' } },
    })
    expect(v).toEqual({
      tipo: 'atendimento', id: 'a1', label: 'Previdenciário', sublabel: 'João · 0001',
      href: '/clientes/c9/casos/a1', removido: false,
    })
  })
  it('processo: apelido/CNJ + cliente, href do cliente', () => {
    const v = resolverVinculoView({
      processo_id: 'p1',
      processo: { id: 'p1', numero_cnj: '00008323420184013300', apelido: null, clientes: { id: 'c2', nome: 'ACME' } },
    })
    expect(v).toEqual({
      tipo: 'processo', id: 'p1', label: '0000832-34.2018.4.01.3300', sublabel: 'ACME',
      href: '/clientes/c2', removido: false,
    })
  })
  it('entidade apagada (join vazio) → removido, sem link', () => {
    const v = resolverVinculoView({ cliente_id: 'c1', cliente: null })
    expect(v).toMatchObject({ tipo: 'cliente', id: 'c1', href: null, removido: true })
  })
  it('aceita embed em array (shape do PostgREST)', () => {
    const v = resolverVinculoView({ cliente_id: 'c1', cliente: [{ id: 'c1', nome: 'Ana' }] })
    expect(v).toMatchObject({ label: 'Ana', removido: false })
  })
})

describe('ehVinculoTipo / COLUNA_POR_TIPO', () => {
  it('valida o enum', () => {
    expect(ehVinculoTipo('cliente')).toBe(true)
    expect(ehVinculoTipo('foo')).toBe(false)
  })
  it('mapeia tipo→coluna', () => {
    expect(COLUNA_POR_TIPO.atendimento).toBe('process_id')
  })
})
