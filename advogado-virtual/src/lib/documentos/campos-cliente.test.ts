import { describe, it, expect } from 'vitest'
import {
  CAMPOS_CLIENTE,
  camposFaltantes,
  extrairPlaceholders,
  PLACEHOLDERS_PADRAO_POR_TIPO,
} from './campos-cliente'

describe('extrairPlaceholders', () => {
  it('extrai {{campo}} de um texto e deduplica', () => {
    const t = 'Eu {{nome_cliente}}, CPF {{cpf_cliente}}, residente. Assina: {{nome_cliente}}.'
    expect(extrairPlaceholders(t)).toEqual(['nome_cliente', 'cpf_cliente'])
  })

  it('aceita espaços internos e ignora texto sem chaves', () => {
    expect(extrairPlaceholders('{{ cep_cliente }} e cidade normal')).toEqual(['cep_cliente'])
  })

  it('texto sem placeholders → []', () => {
    expect(extrairPlaceholders('nenhum placeholder aqui')).toEqual([])
  })
})

describe('camposFaltantes', () => {
  const cliente = {
    nome: 'Fulano de Tal',
    cpf: '',            // vazio
    rg: null,           // vazio
    orgao_expedidor: '  ', // só espaço = vazio
    cidade: 'Curitiba',
  }

  it('retorna só campos DO CLIENTE usados e vazios', () => {
    const usados = ['nome_cliente', 'cpf_cliente', 'rg_cliente', 'cidade_cliente']
    const faltam = camposFaltantes(cliente, usados)
    expect(faltam.map((c) => c.placeholder)).toEqual(['cpf_cliente', 'rg_cliente'])
    // nome e cidade estão preenchidos → não entram
  })

  it('espaço em branco conta como vazio', () => {
    const faltam = camposFaltantes(cliente, ['orgao_expedidor_cliente'])
    expect(faltam.map((c) => c.campo)).toEqual(['orgao_expedidor'])
  })

  it('ignora placeholders que não são do cliente (objeto, oab, nome_advogado)', () => {
    const faltam = camposFaltantes(cliente, ['objeto', 'oab', 'nome_advogado', 'data'])
    expect(faltam).toEqual([])
  })

  it('deduplica placeholder repetido', () => {
    const faltam = camposFaltantes(cliente, ['cpf_cliente', 'cpf_cliente'])
    expect(faltam).toHaveLength(1)
  })

  it('resolve placeholder → { campo, label, tipo }', () => {
    const [cpf] = camposFaltantes(cliente, ['cpf_cliente'])
    expect(cpf).toMatchObject({ placeholder: 'cpf_cliente', campo: 'cpf', tipo: 'cpf' })
    expect(cpf.label).toBeTruthy()
  })
})

describe('CAMPOS_CLIENTE', () => {
  it('cobre os 14 campos do cliente do montarPlaceholders', () => {
    expect(Object.keys(CAMPOS_CLIENTE)).toHaveLength(14)
  })

  it('todo placeholder termina em _cliente e aponta uma coluna', () => {
    for (const [ph, def] of Object.entries(CAMPOS_CLIENTE)) {
      expect(ph.endsWith('_cliente')).toBe(true)
      expect(def.campo).toBeTruthy()
    }
  })
})

describe('PLACEHOLDERS_PADRAO_POR_TIPO', () => {
  it('todo placeholder padrão é um campo conhecido do cliente', () => {
    for (const lista of Object.values(PLACEHOLDERS_PADRAO_POR_TIPO)) {
      for (const ph of lista) expect(CAMPOS_CLIENTE[ph]).toBeDefined()
    }
  })
})
