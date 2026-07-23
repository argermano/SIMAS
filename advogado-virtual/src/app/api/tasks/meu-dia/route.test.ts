import { describe, it, expect } from 'vitest'
import {
  PESO_PRIORIDADE,
  compararMeuDia,
  limitesDiaUTC,
  escolherComecePorAqui,
  type ItemMeuDia,
} from './route'

const item = (id: string, prioridade: ItemMeuDia['prioridade']): ItemMeuDia => ({
  id,
  titulo: id,
  prioridade,
  vinculoRotulo: null,
})

describe('compararMeuDia', () => {
  it('ordena por prioridade urgente>alta>media>baixa', () => {
    const entrada = [
      { priority: 'baixa' as const, due_date: '2026-07-23T00:00:00Z' },
      { priority: 'urgente' as const, due_date: '2026-07-23T00:00:00Z' },
      { priority: 'media' as const, due_date: '2026-07-23T00:00:00Z' },
      { priority: 'alta' as const, due_date: '2026-07-23T00:00:00Z' },
    ]
    const ordem = [...entrada].sort(compararMeuDia).map((t) => t.priority)
    expect(ordem).toEqual(['urgente', 'alta', 'media', 'baixa'])
  })

  it('em empate de prioridade, o vencimento mais antigo vem primeiro', () => {
    const entrada = [
      { priority: 'alta' as const, due_date: '2026-07-20T00:00:00Z' },
      { priority: 'alta' as const, due_date: '2026-07-10T00:00:00Z' },
      { priority: 'alta' as const, due_date: '2026-07-15T00:00:00Z' },
    ]
    const ordem = [...entrada].sort(compararMeuDia).map((t) => t.due_date)
    expect(ordem).toEqual([
      '2026-07-10T00:00:00Z',
      '2026-07-15T00:00:00Z',
      '2026-07-20T00:00:00Z',
    ])
  })

  it('pesos crescem do mais urgente ao menos urgente', () => {
    expect(PESO_PRIORIDADE.urgente).toBeLessThan(PESO_PRIORIDADE.alta)
    expect(PESO_PRIORIDADE.alta).toBeLessThan(PESO_PRIORIDADE.media)
    expect(PESO_PRIORIDADE.media).toBeLessThan(PESO_PRIORIDADE.baixa)
  })
})

describe('limitesDiaUTC', () => {
  it('fronteiras em meia-noite UTC do dia e do dia seguinte', () => {
    expect(limitesDiaUTC('2026-07-23')).toEqual({
      inicioHojeUTC: '2026-07-23T00:00:00.000Z',
      inicioAmanhaUTC: '2026-07-24T00:00:00.000Z',
    })
  })

  it('vira o mês corretamente', () => {
    expect(limitesDiaUTC('2026-07-31').inicioAmanhaUTC).toBe('2026-08-01T00:00:00.000Z')
  })

  it('vira o ano corretamente', () => {
    expect(limitesDiaUTC('2026-12-31').inicioAmanhaUTC).toBe('2027-01-01T00:00:00.000Z')
  })
})

describe('escolherComecePorAqui', () => {
  it('prioriza a primeira das atrasadas quando há atrasadas', () => {
    const r = escolherComecePorAqui([item('a1', 'alta'), item('a2', 'media')], [item('h1', 'urgente')])
    expect(r).toEqual({ id: 'a1', criterio: 'A mais urgente entre as atrasadas' })
  })

  it('cai para a primeira de hoje quando não há atrasadas', () => {
    const r = escolherComecePorAqui([], [item('h1', 'alta'), item('h2', 'baixa')])
    expect(r).toEqual({ id: 'h1', criterio: 'A mais urgente entre as que vencem hoje' })
  })

  it('retorna null quando nada vence', () => {
    expect(escolherComecePorAqui([], [])).toBeNull()
  })
})
