import { describe, it, expect } from 'vitest'
import {
  ROTULO_UNIDADE,
  UNIDADES,
  proximasPresencas,
  type PresencaRow,
} from './presenca'

const HOJE = '2026-07-10'

const ROWS: PresencaRow[] = [
  { data: '2026-07-08', unidade: 'blumenau' },      // passado — fora
  { data: '2026-07-10', unidade: 'blumenau' },      // hoje — entra
  { data: '2026-07-15', unidade: 'blumenau' },
  { data: '2026-07-12', unidade: 'florianopolis' }, // outra unidade
  { data: '2026-08-01', unidade: 'blumenau' },
  { data: '2026-07-11', unidade: 'brasilia' },
]

describe('ROTULO_UNIDADE', () => {
  it('mapeia os 3 slugs para rótulos com acento', () => {
    expect(ROTULO_UNIDADE.brasilia).toBe('Brasília')
    expect(ROTULO_UNIDADE.florianopolis).toBe('Florianópolis')
    expect(ROTULO_UNIDADE.blumenau).toBe('Blumenau')
    expect(UNIDADES).toEqual(['brasilia', 'florianopolis', 'blumenau'])
  })
})

describe('proximasPresencas', () => {
  it('só datas futuras (hoje inclusive) da unidade, ordenadas', () => {
    expect(proximasPresencas(ROWS, 'blumenau', HOJE, 5)).toEqual([
      '2026-07-10', '2026-07-15', '2026-08-01',
    ])
  })

  it('exclui o passado e outras unidades', () => {
    expect(proximasPresencas(ROWS, 'florianopolis', HOJE, 5)).toEqual(['2026-07-12'])
    expect(proximasPresencas(ROWS, 'brasilia', '2026-07-12', 5)).toEqual([])
  })

  it('respeita o limite', () => {
    expect(proximasPresencas(ROWS, 'blumenau', HOJE, 2)).toEqual([
      '2026-07-10', '2026-07-15',
    ])
    expect(proximasPresencas(ROWS, 'blumenau', HOJE, 0)).toEqual([])
  })

  it('deduplica datas repetidas e aceita data com hora (trunca em YYYY-MM-DD)', () => {
    const rows: PresencaRow[] = [
      { data: '2026-07-15', unidade: 'blumenau' },
      { data: '2026-07-15T00:00:00', unidade: 'blumenau' },
      { data: '2026-07-11', unidade: 'blumenau' },
    ]
    expect(proximasPresencas(rows, 'blumenau', HOJE, 5)).toEqual([
      '2026-07-11', '2026-07-15',
    ])
  })

  it('lista vazia => vazio', () => {
    expect(proximasPresencas([], 'blumenau', HOJE, 5)).toEqual([])
  })
})
