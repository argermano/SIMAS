import { describe, it, expect } from 'vitest'
import { chaveDuplicidade, marcarPossiveisDuplicados, type ItemDup } from './duplicados'

// Helper: item do inbox só com os campos que a marcação usa.
const item = (dados: Record<string, unknown> | null, telefone = '5541999999999'): ItemDup => ({ dados, telefone })

describe('chaveDuplicidade', () => {
  it('usa o endToEndId (trim) como chave forte quando presente', () => {
    expect(chaveDuplicidade(item({ endToEndId: '  E123  ', valorCentavos: 100, dataISO: '2026-07-11' })))
      .toBe('e2e:E123')
  })

  it('cai para valor+data+telefone quando não há e2e (data ignora a hora)', () => {
    expect(chaveDuplicidade(item({ valorCentavos: 5000, dataISO: '2026-07-11T09:30:00Z' })))
      .toBe('vdt:5000|2026-07-11|5541999999999')
  })

  it('retorna null sem sinais suficientes (sem e2e e sem valor/data/telefone)', () => {
    expect(chaveDuplicidade(item({ valorCentavos: 5000 }))).toBeNull()          // falta data
    expect(chaveDuplicidade(item({ dataISO: '2026-07-11' }))).toBeNull()        // falta valor
    expect(chaveDuplicidade(item({ valorCentavos: 5000, dataISO: '2026-07-11' }, ''))).toBeNull() // falta telefone
    expect(chaveDuplicidade(item(null))).toBeNull()
    expect(chaveDuplicidade(item({ endToEndId: '   ' }))).toBeNull()            // e2e vazio pós-trim
  })
})

describe('marcarPossiveisDuplicados', () => {
  it('marca AMBOS os itens que dividem o mesmo endToEndId', () => {
    const r = marcarPossiveisDuplicados([
      item({ endToEndId: 'E1', valorCentavos: 100, dataISO: '2026-07-11' }),
      item({ endToEndId: 'E1', valorCentavos: 100, dataISO: '2026-07-12' }), // data diferente, mesmo e2e
      item({ endToEndId: 'E2', valorCentavos: 100, dataISO: '2026-07-11' }),
    ])
    expect(r.map((x) => x.possivelDuplicado)).toEqual([true, true, false])
  })

  it('fallback: mesmo valor+data+telefone (sem e2e) marca os dois', () => {
    const r = marcarPossiveisDuplicados([
      item({ valorCentavos: 5000, dataISO: '2026-07-11' }, '5541988887777'),
      item({ valorCentavos: 5000, dataISO: '2026-07-11T23:00:00Z' }, '5541988887777'),
      item({ valorCentavos: 5000, dataISO: '2026-07-11' }, '5541900000000'), // telefone diferente
    ])
    expect(r.map((x) => x.possivelDuplicado)).toEqual([true, true, false])
  })

  it('não marca itens sem chave, mesmo repetidos', () => {
    const r = marcarPossiveisDuplicados([item({ valorCentavos: 5000 }), item({ valorCentavos: 5000 })])
    expect(r.every((x) => x.possivelDuplicado === false)).toBe(true)
  })

  it('e2e não colide com a chave de valor+data+telefone', () => {
    const r = marcarPossiveisDuplicados([
      item({ endToEndId: '100', valorCentavos: 100, dataISO: '2026-07-11' }),
      item({ valorCentavos: 100, dataISO: '2026-07-11' }, '100'),
    ])
    expect(r.map((x) => x.possivelDuplicado)).toEqual([false, false])
  })

  it('preserva os demais campos do item', () => {
    const [a] = marcarPossiveisDuplicados([{ ...item({ endToEndId: 'X' }), extra: 42 }])
    expect(a).toMatchObject({ extra: 42, possivelDuplicado: false })
  })
})
