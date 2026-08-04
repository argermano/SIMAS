import { describe, it, expect } from 'vitest'
import { mesclarMensagens, menorId } from './paginacao'
import type { Mensagem } from './tipos'

// Fixture mínima de mensagem; sobrescreve só o que o teste precisa.
function msg(id: number, over: Partial<Mensagem> = {}): Mensagem {
  return {
    id,
    direcao: 'entrada',
    privada: false,
    conteudo: `m${id}`,
    anexos: [],
    sender: { tipo: 'cliente', nome: 'Cliente' },
    timestamp: 1_700_000_000 + id,
    ...over,
  }
}

describe('mesclarMensagens', () => {
  it('ordena por id crescente mesmo com entrada fora de ordem', () => {
    const r = mesclarMensagens([msg(30), msg(10)], [msg(20)])
    expect(r.map((m) => m.id)).toEqual([10, 20, 30])
  })

  it('deduplica por id e faz as NOVAS prevalecerem', () => {
    const r = mesclarMensagens([msg(1, { conteudo: 'velho' })], [msg(1, { conteudo: 'novo' })])
    expect(r).toHaveLength(1)
    expect(r[0].conteudo).toBe('novo')
  })

  it('prepend: a página anterior entra na frente do que já estava na tela', () => {
    const naTela = [msg(50), msg(51), msg(52)]
    const anteriores = [msg(47), msg(48), msg(49)]
    const r = mesclarMensagens(naTela, anteriores)
    expect(r.map((m) => m.id)).toEqual([47, 48, 49, 50, 51, 52])
  })

  it('refresh: a página recente NÃO perde o prefixo antigo já paginado', () => {
    // Estado após duas páginas para trás + uma mensagem nova chegando no refresh.
    const naTela = [msg(47), msg(48), msg(49), msg(50), msg(51)]
    const refresh = [msg(50), msg(51), msg(52)]
    const r = mesclarMensagens(naTela, refresh)
    expect(r.map((m) => m.id)).toEqual([47, 48, 49, 50, 51, 52])
  })

  it('listas vazias em qualquer lado são inertes', () => {
    expect(mesclarMensagens([], [])).toEqual([])
    expect(mesclarMensagens([], [msg(5)]).map((m) => m.id)).toEqual([5])
    expect(mesclarMensagens([msg(5)], []).map((m) => m.id)).toEqual([5])
  })

  it('não muta as listas recebidas', () => {
    const atuais = [msg(2), msg(1)]
    const novas = [msg(3)]
    mesclarMensagens(atuais, novas)
    expect(atuais.map((m) => m.id)).toEqual([2, 1])
    expect(novas.map((m) => m.id)).toEqual([3])
  })
})

describe('menorId', () => {
  it('devolve o menor id (cursor do before=)', () => {
    expect(menorId([msg(50), msg(48), msg(49)])).toBe(48)
  })

  it('null quando não há mensagens', () => {
    expect(menorId([])).toBeNull()
  })
})
