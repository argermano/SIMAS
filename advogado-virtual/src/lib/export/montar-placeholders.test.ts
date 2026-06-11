import { describe, it, expect } from 'vitest'
import { montarPlaceholders, formatarMoeda, formatarOAB } from './montar-placeholders'

const HOJE = new Date('2026-06-11T12:00:00-03:00')

const TENANT = {
  nome: 'Silva Advocacia',
  nome_responsavel: 'Dr. João Silva',
  oab_numero: '12345',
  oab_estado: 'SP',
  cpf_responsavel: '111.222.333-44',
  estado_civil: 'casado',
  nacionalidade: 'brasileiro',
  endereco: 'Av. Paulista, 100',
  cidade: 'São Paulo',
  estado: 'SP',
  email_profissional: 'joao@silva.adv.br',
  telefone: '(11) 99999-0000',
}

const CLIENTE = {
  nome: 'MARIA SOUZA',
  cpf: '123.456.789-00',
  rg: '12.345.678-9',
  estado_civil: 'solteira',
  profissao: 'professora',
  endereco: 'Rua A, 50',
  cidade: 'Campinas',
  estado: 'SP',
}

describe('formatarMoeda', () => {
  it('formata número em pt-BR com 2 casas', () => {
    expect(formatarMoeda(3000)).toBe('3.000,00')
    expect(formatarMoeda('1500.5')).toBe('1.500,50')
  })
  it('vazio para null/empty', () => {
    expect(formatarMoeda(null)).toBe('')
    expect(formatarMoeda('')).toBe('')
  })
})

describe('formatarOAB', () => {
  it('combina número e estado', () => {
    expect(formatarOAB('12345', 'SP')).toBe('12345/SP')
  })
  it('número sem estado', () => {
    expect(formatarOAB('12345', null)).toBe('12345')
  })
  it('vazio sem número', () => {
    expect(formatarOAB(null, 'SP')).toBe('')
  })
})

describe('montarPlaceholders', () => {
  it('mapeia cliente e escritório com aliases de OAB e data', () => {
    const d = montarPlaceholders({ tenant: TENANT, cliente: CLIENTE, hoje: HOJE })
    expect(d.nome_cliente).toBe('MARIA SOUZA')
    expect(d.cpf_cliente).toBe('123.456.789-00')
    expect(d.profissao_cliente).toBe('professora')
    expect(d.escritorio).toBe('Silva Advocacia')
    expect(d.nome_advogado).toBe('Dr. João Silva')
    expect(d.oab).toBe('12345/SP')
    expect(d.numero_oab).toBe('12345')
    expect(d.estado_oab).toBe('SP')
    expect(d.data).toBe('11 de junho de 2026')
    expect(d.data_extenso).toBe(d.data)
    expect(d.cidade).toBe('Campinas') // fecho usa cidade do cliente
  })

  it('campos ausentes viram string vazia', () => {
    const d = montarPlaceholders({ tenant: null, cliente: null, hoje: HOJE })
    expect(d.nome_cliente).toBe('')
    expect(d.oab).toBe('')
    expect(d.cidade).toBe('')
  })

  it('inclui e formata dados de contrato', () => {
    const d = montarPlaceholders({
      tenant: TENANT, cliente: CLIENTE, hoje: HOJE,
      contrato: { titulo: 'Contrato X', area: 'Cível', valor_fixo: 3000, percentual_exito: 20, forma_pagamento: 'À vista' },
    })
    expect(d.titulo).toBe('Contrato X')
    expect(d.valor_fixo).toBe('3.000,00')
    expect(d.percentual_exito).toBe('20%')
    expect(d.forma_pagamento).toBe('À vista')
  })

  it('extras sobrescrevem e ignoram vazios', () => {
    const d = montarPlaceholders({
      tenant: TENANT, cliente: CLIENTE, hoje: HOJE,
      extras: { objeto: 'Representação judicial', nome_substabelecido: 'Dra. Ana', oab_substabelecido: '999/RJ', vazio: '' },
    })
    expect(d.objeto).toBe('Representação judicial')
    expect(d.nome_substabelecido).toBe('Dra. Ana')
    expect(d.oab_substabelecido).toBe('999/RJ')
    expect(d.vazio).toBeUndefined() // vazio não sobrescreve nem cria
    expect(d.nome_cliente).toBe('MARIA SOUZA') // base preservado
  })
})
