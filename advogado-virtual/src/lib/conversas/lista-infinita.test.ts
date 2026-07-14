import { describe, it, expect } from 'vitest'
import {
  dedupPorId,
  mesclarPaginas,
  temMaisPorContagem,
  mesmaLista,
  TAMANHO_PAGINA_CONVERSAS,
} from './lista-infinita'
import type { Conversa } from './tipos'

// Fixture mínima de conversa; sobrescreve só o que o teste precisa.
function conv(id: number, over: Partial<Conversa> = {}): Conversa {
  return {
    id,
    contato: { nome: `C${id}`, telefone: `1199900${id}`, avatarUrl: null },
    inbox: 'DF',
    status: 'open',
    assignee: null,
    ultimaMensagem: { trecho: 'oi', timestamp: 1000 + id, direcao: 'entrada' },
    naoLidas: 0,
    aguardandoDesde: null,
    labels: [],
    ...over,
  }
}

describe('dedupPorId', () => {
  it('preserva a 1ª ocorrência e a ordem', () => {
    const r = dedupPorId([conv(1), conv(2), conv(1, { naoLidas: 9 }), conv(3)])
    expect(r.map((c) => c.id)).toEqual([1, 2, 3])
    // manteve a PRIMEIRA (naoLidas 0), não a segunda (naoLidas 9)
    expect(r[0].naoLidas).toBe(0)
  })

  it('lista sem repetição volta igual', () => {
    expect(dedupPorId([conv(1), conv(2)]).map((c) => c.id)).toEqual([1, 2])
  })
})

describe('mesclarPaginas', () => {
  it('concatena páginas na ordem e deduplica ids que migraram entre páginas', () => {
    const p1 = [conv(10), conv(11)]
    // 11 reaparece na p2 (raça durante fetch paralelo): fica só na 1ª posição
    const p2 = [conv(11), conv(12), conv(13)]
    const r = mesclarPaginas([p1, p2])
    expect(r.map((c) => c.id)).toEqual([10, 11, 12, 13])
  })
})

describe('temMaisPorContagem', () => {
  it('página cheia pode ter próxima; página incompleta ou vazia é o fim', () => {
    expect(temMaisPorContagem(TAMANHO_PAGINA_CONVERSAS)).toBe(true)
    expect(temMaisPorContagem(TAMANHO_PAGINA_CONVERSAS - 1)).toBe(false)
    expect(temMaisPorContagem(0)).toBe(false)
  })

  it('aceita tamanho de página customizado', () => {
    expect(temMaisPorContagem(10, 10)).toBe(true)
    expect(temMaisPorContagem(9, 10)).toBe(false)
  })
})

describe('mesmaLista', () => {
  it('listas idênticas (mesma ordem + campos) são iguais', () => {
    expect(mesmaLista([conv(1), conv(2)], [conv(1), conv(2)])).toBe(true)
  })

  it('troca de campo renderizado quebra a igualdade', () => {
    expect(mesmaLista([conv(1)], [conv(1, { naoLidas: 3 })])).toBe(false)
    expect(mesmaLista([conv(1)], [conv(1, { aguardandoDesde: 999 })])).toBe(false)
    expect(
      mesmaLista(
        [conv(1)],
        [conv(1, { ultimaMensagem: { trecho: 'nova', timestamp: 2000, direcao: 'saida' } })],
      ),
    ).toBe(false)
  })

  it('reordenação e tamanho diferente quebram a igualdade', () => {
    expect(mesmaLista([conv(1), conv(2)], [conv(2), conv(1)])).toBe(false)
    expect(mesmaLista([conv(1)], [conv(1), conv(2)])).toBe(false)
  })
})
