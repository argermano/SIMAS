import { describe, it, expect } from 'vitest'
import {
  horas,
  chaveDia,
  mesmoDia,
  diasDaSemana,
  semanasDoMes,
  intervaloDaVista,
  rotuloPeriodo,
} from './grade'

// Brasil sem horário de verão (desde 2019): America/Sao_Paulo = UTC-3 o ano todo.
// Instante-âncora: quinta-feira 2026-07-09 12:00Z (= 09:00 em SP).
const REF = '2026-07-09T12:00:00.000Z'

describe('horas', () => {
  it('retorna 0..23', () => {
    const h = horas()
    expect(h).toHaveLength(24)
    expect(h[0]).toBe(0)
    expect(h[23]).toBe(23)
  })
})

describe('chaveDia / mesmoDia — virada de dia em SP', () => {
  it('instante ainda no dia anterior em SP (UTC-3)', () => {
    // 02:00Z => 23:00 SP do dia 09
    expect(chaveDia('2026-07-10T02:00:00.000Z')).toBe('2026-07-09')
    // 03:00Z => 00:00 SP do dia 10
    expect(chaveDia('2026-07-10T03:00:00.000Z')).toBe('2026-07-10')
  })

  it('mesmoDia respeita a TZ de SP', () => {
    expect(mesmoDia('2026-07-10T02:00:00.000Z', REF)).toBe(true)
    expect(mesmoDia('2026-07-10T03:00:00.000Z', REF)).toBe(false)
  })

  it('virada de mês em SP', () => {
    // 01/08 01:00Z => 31/07 22:00 SP
    expect(chaveDia('2026-08-01T01:00:00.000Z')).toBe('2026-07-31')
  })
})

describe('diasDaSemana — Dom..Sáb', () => {
  it('semana de 05/07 a 11/07 (quinta 09/07)', () => {
    const dias = diasDaSemana(REF)
    expect(dias).toHaveLength(7)
    expect(dias.map(chaveDia)).toEqual([
      '2026-07-05', '2026-07-06', '2026-07-07', '2026-07-08',
      '2026-07-09', '2026-07-10', '2026-07-11',
    ])
    // início de dia = 00:00 SP = 03:00Z
    expect(dias[0]).toBe('2026-07-05T03:00:00.000Z')
    expect(dias[6]).toBe('2026-07-11T03:00:00.000Z')
  })

  it('domingo permanece no início da própria semana', () => {
    const dias = diasDaSemana('2026-07-05T12:00:00.000Z')
    expect(chaveDia(dias[0])).toBe('2026-07-05')
    expect(chaveDia(dias[6])).toBe('2026-07-11')
  })
})

describe('semanasDoMes — grade completa', () => {
  it('julho/2026 gera 5 semanas Dom..Sáb, com dias adjacentes', () => {
    const semanas = semanasDoMes(REF)
    expect(semanas).toHaveLength(5)
    for (const s of semanas) expect(s).toHaveLength(7)
    // 1º de julho é quarta => grade começa no domingo 28/06
    expect(chaveDia(semanas[0][0])).toBe('2026-06-28')
    // 31/07 é sexta => grade termina no sábado 01/08
    expect(chaveDia(semanas[4][6])).toBe('2026-08-01')
  })
})

describe('intervaloDaVista — [de, ate] inclusivo em SP', () => {
  it('dia', () => {
    const { de, ate } = intervaloDaVista('dia', REF)
    expect(de).toBe('2026-07-09T03:00:00.000Z')
    expect(ate).toBe('2026-07-10T02:59:59.999Z')
  })

  it('semana', () => {
    const { de, ate } = intervaloDaVista('semana', REF)
    expect(de).toBe('2026-07-05T03:00:00.000Z')
    expect(ate).toBe('2026-07-12T02:59:59.999Z')
  })

  it('mes cobre toda a grade', () => {
    const { de, ate } = intervaloDaVista('mes', REF)
    expect(de).toBe('2026-06-28T03:00:00.000Z')
    expect(ate).toBe('2026-08-02T02:59:59.999Z')
  })
})

describe('rotuloPeriodo', () => {
  it('dia', () => {
    expect(rotuloPeriodo('dia', REF)).toBe('9 de Julho de 2026')
  })

  it('semana no mesmo mês', () => {
    expect(rotuloPeriodo('semana', REF)).toBe('5 – 11 de Julho de 2026')
  })

  it('semana cruzando o mês', () => {
    // semana de 28/06 a 04/07 (ref domingo 28/06)
    expect(rotuloPeriodo('semana', '2026-06-28T12:00:00.000Z'))
      .toBe('28 de Junho – 4 de Julho de 2026')
  })

  it('semana cruzando o ano', () => {
    // 2026-12-31 é quinta => semana 27/12/2026 a 02/01/2027
    expect(rotuloPeriodo('semana', '2026-12-31T12:00:00.000Z'))
      .toBe('27 de Dezembro de 2026 – 2 de Janeiro de 2027')
  })

  it('mes', () => {
    expect(rotuloPeriodo('mes', REF)).toBe('Julho de 2026')
  })
})
