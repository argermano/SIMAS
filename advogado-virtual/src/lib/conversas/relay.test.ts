import { describe, it, expect } from 'vitest'
import { montarUrl } from './relay'

const BASE = 'https://agenda.apoiojuridicodf.adv.br/relay'

describe('montarUrl', () => {
  it('junta base + path sem query', () => {
    expect(montarUrl(BASE, '/conversations')).toBe(`${BASE}/conversations`)
  })

  it('adiciona "/" quando o path não começa com barra', () => {
    expect(montarUrl(BASE, 'agents')).toBe(`${BASE}/agents`)
  })

  it('remove barras finais da base para não duplicar', () => {
    expect(montarUrl(`${BASE}/`, '/agents')).toBe(`${BASE}/agents`)
    expect(montarUrl(`${BASE}///`, '/agents')).toBe(`${BASE}/agents`)
  })

  it('anexa query string, ignorando valores undefined', () => {
    const url = montarUrl(BASE, '/conversations', {
      status: 'open',
      inbox: undefined,
      page: '1',
    })
    expect(url).toBe(`${BASE}/conversations?status=open&page=1`)
  })

  it('não adiciona "?" quando toda a query é undefined', () => {
    const url = montarUrl(BASE, '/conversations', { status: undefined, inbox: undefined })
    expect(url).toBe(`${BASE}/conversations`)
  })

  it('usa "&" quando o path já contém "?"', () => {
    const url = montarUrl(BASE, '/conversations?fixed=1', { page: '2' })
    expect(url).toBe(`${BASE}/conversations?fixed=1&page=2`)
  })

  it('faz encode dos valores da query', () => {
    const url = montarUrl(BASE, '/x', { q: 'a b&c' })
    expect(url).toBe(`${BASE}/x?q=a+b%26c`)
  })
})
