import { describe, it, expect } from 'vitest'
import { createSSEParser } from './sse-parser'

describe('createSSEParser', () => {
  it('interpreta um evento completo num único chunk', () => {
    const p = createSSEParser()
    const evs = p.feed('data: {"type":"text","text":"olá"}\n\n')
    expect(evs).toEqual([{ type: 'text', text: 'olá' }])
  })

  it('junta um evento partido entre dois chunks (o bug corrigido)', () => {
    const p = createSSEParser()
    // O JSON é cortado no meio, na fronteira de rede
    expect(p.feed('data: {"type":"text","te')).toEqual([])
    const evs = p.feed('xt":"continua"}\n')
    expect(evs).toEqual([{ type: 'text', text: 'continua' }])
  })

  it('processa múltiplos eventos num só chunk', () => {
    const p = createSSEParser()
    const evs = p.feed(
      'data: {"type":"text","text":"a"}\n\n' +
      'data: {"type":"text","text":"b"}\n\n',
    )
    expect(evs).toEqual([
      { type: 'text', text: 'a' },
      { type: 'text', text: 'b' },
    ])
  })

  it('ignora linhas malformadas sem lançar', () => {
    const p = createSSEParser()
    const evs = p.feed('data: {quebrado\n\ndata: {"type":"done","stopReason":"end_turn"}\n\n')
    expect(evs).toEqual([{ type: 'done', stopReason: 'end_turn' }])
  })

  it('carrega o stopReason no evento done', () => {
    const p = createSSEParser()
    const evs = p.feed('data: {"type":"done","inputTokens":10,"outputTokens":20,"stopReason":"max_tokens"}\n\n')
    expect(evs).toEqual([{ type: 'done', inputTokens: 10, outputTokens: 20, stopReason: 'max_tokens' }])
  })

  it('preserva o evento error para o chamador despachar', () => {
    const p = createSSEParser()
    const evs = p.feed('data: {"type":"error","error":"cota excedida"}\n\n')
    expect(evs).toEqual([{ type: 'error', error: 'cota excedida' }])
  })

  it('tolera terminação \\r\\n', () => {
    const p = createSSEParser()
    const evs = p.feed('data: {"type":"text","text":"x"}\r\n')
    expect(evs).toEqual([{ type: 'text', text: 'x' }])
  })

  it('flush interpreta uma última linha sem \\n final', () => {
    const p = createSSEParser()
    expect(p.feed('data: {"type":"done","stopReason":"end_turn"}')).toEqual([])
    expect(p.flush()).toEqual([{ type: 'done', stopReason: 'end_turn' }])
  })

  it('feed vazio e flush vazio não produzem eventos', () => {
    const p = createSSEParser()
    expect(p.feed('')).toEqual([])
    expect(p.flush()).toEqual([])
  })
})
