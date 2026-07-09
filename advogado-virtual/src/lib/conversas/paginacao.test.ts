import { describe, it, expect } from 'vitest'
import { metaTemProxima } from './paginacao'

describe('metaTemProxima', () => {
  it('retorna null para meta ausente ou não-objeto (mantém comportamento antigo)', () => {
    expect(metaTemProxima(null, 1)).toBeNull()
    expect(metaTemProxima(undefined, 1)).toBeNull()
    expect(metaTemProxima('x', 1)).toBeNull()
    expect(metaTemProxima(42, 1)).toBeNull()
    expect(metaTemProxima({}, 1)).toBeNull()
  })

  it('usa flag booleana direta quando presente', () => {
    expect(metaTemProxima({ temProxima: true }, 1)).toBe(true)
    expect(metaTemProxima({ hasNext: false }, 3)).toBe(false)
    expect(metaTemProxima({ has_more: true }, 2)).toBe(true)
  })

  it('deriva de total de páginas + página atual', () => {
    expect(metaTemProxima({ totalPaginas: 3 }, 2)).toBe(true)
    expect(metaTemProxima({ totalPages: 3 }, 3)).toBe(false)
    // usa a página vinda do meta quando existe, no lugar do argumento
    expect(metaTemProxima({ total_pages: 5, current_page: 5 }, 1)).toBe(false)
  })

  it('deriva de total de itens + itens por página', () => {
    // página 1 de 25 itens/página, 30 no total => há próxima
    expect(metaTemProxima({ total: 30, perPage: 25 }, 1)).toBe(true)
    // página 2, 30 no total, 25/página => 50 >= 30 => não há próxima
    expect(metaTemProxima({ total: 30, perPage: 25 }, 2)).toBe(false)
    // exatamente cheio na última página
    expect(metaTemProxima({ count: 50, page_size: 25 }, 2)).toBe(false)
  })

  it('ignora números inválidos e cai para null', () => {
    expect(metaTemProxima({ total: 'x', perPage: 25 }, 1)).toBeNull()
    expect(metaTemProxima({ totalPaginas: Number.NaN }, 1)).toBeNull()
    expect(metaTemProxima({ total: 30, perPage: 0 }, 1)).toBeNull()
  })
})
