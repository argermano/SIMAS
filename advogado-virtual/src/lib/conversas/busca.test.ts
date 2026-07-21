import { describe, it, expect } from 'vitest'
import { conversaCasaBusca, normalizarBusca, pareceNumero } from './busca'
import type { Conversa } from './tipos'

// Só a lógica pura do matcher (nome/telefone). A varredura em si (paginação/
// anti-corrida) vive no componente e não é testada aqui.

function conversa(over: Partial<Conversa> & { nome?: string | null; telefone?: string | null; trecho?: string }): Conversa {
  const { nome = null, telefone = null, trecho, ...rest } = over
  return {
    id: 1,
    contato: { nome, telefone },
    inbox: 'DF',
    status: 'open',
    assignee: null,
    ultimaMensagem: trecho !== undefined ? { trecho, timestamp: 0 } : null,
    naoLidas: 0,
    aguardandoDesde: null,
    labels: [],
    ...rest,
  }
}

describe('normalizarBusca', () => {
  it('minúsculas + sem acentos', () => {
    expect(normalizarBusca('José DA SÃO')).toBe('jose da sao')
    expect(normalizarBusca('Conceição')).toBe('conceicao')
  })
})

describe('pareceNumero', () => {
  it('≥ 3 dígitos parece número; menos não', () => {
    expect(pareceNumero('479')).toBe(true)
    expect(pareceNumero('(47)')).toBe(false) // só 2 dígitos
    expect(pareceNumero('ana')).toBe(false)
  })
})

describe('conversaCasaBusca — nome (case/acento-insensível)', () => {
  it('casa nome ignorando caixa e acento', () => {
    const c = conversa({ nome: 'José da Conceição' })
    expect(conversaCasaBusca(c, 'jose')).toBe(true)
    expect(conversaCasaBusca(c, 'CONCEICAO')).toBe(true)
    expect(conversaCasaBusca(c, 'maria')).toBe(false)
  })

  it('casa trecho da última mensagem', () => {
    const c = conversa({ nome: 'Ana', trecho: 'Bom dia, preciso do contrato' })
    expect(conversaCasaBusca(c, 'contrato')).toBe(true)
  })

  it('termo vazio casa tudo (sem filtro)', () => {
    expect(conversaCasaBusca(conversa({ nome: null }), '  ')).toBe(true)
  })

  it('nome/telefone nulos não quebram', () => {
    const c = conversa({ nome: null, telefone: null })
    expect(conversaCasaBusca(c, 'ana')).toBe(false)
  })
})

describe('conversaCasaBusca — telefone (quando parece número)', () => {
  it('casa por mesmoTelefone (máscara/DDI/9º dígito)', () => {
    const c = conversa({ nome: 'Ana', telefone: '+55 47 99118-6787' })
    expect(conversaCasaBusca(c, '4799118-6787')).toBe(true)
    expect(conversaCasaBusca(c, '4791186787')).toBe(true) // sem o 9º dígito
  })

  it('casa por inclusão parcial de dígitos', () => {
    const c = conversa({ nome: 'Ana', telefone: '(47) 99118-6787' })
    expect(conversaCasaBusca(c, '9118')).toBe(true)
    expect(conversaCasaBusca(c, '0000')).toBe(false)
  })

  it('não tenta telefone com menos de 3 dígitos', () => {
    const c = conversa({ nome: 'Ana', telefone: '4799118-6787' })
    expect(conversaCasaBusca(c, '47')).toBe(false) // 2 dígitos, sem match de nome
  })
})
