import { describe, it, expect } from 'vitest'
import { hojeSaoPauloISO, proximoDiaUtil, normalizarOab } from './util'

describe('proximoDiaUtil — próximo dia útil (só pula fim de semana, SEM feriados)', () => {
  it('sexta → segunda (pula sáb/dom)', () => {
    // 2026-07-10 é sexta-feira → segunda 2026-07-13
    expect(proximoDiaUtil('2026-07-10')).toBe('2026-07-13')
  })
  it('sábado → segunda', () => {
    // 2026-07-11 é sábado → segunda 2026-07-13
    expect(proximoDiaUtil('2026-07-11')).toBe('2026-07-13')
  })
  it('quarta → quinta (dia útil comum)', () => {
    // 2026-07-08 é quarta → quinta 2026-07-09
    expect(proximoDiaUtil('2026-07-08')).toBe('2026-07-09')
  })
  it('não escorrega de dia em borda de mês', () => {
    // 2026-07-31 é sexta → segunda 2026-08-03
    expect(proximoDiaUtil('2026-07-31')).toBe('2026-08-03')
  })
})

describe('normalizarOab — preserva sufixo de inscrição suplementar', () => {
  it("'75.503-A' → '75503A' (preserva a letra)", () => {
    expect(normalizarOab('75.503-A')).toBe('75503A')
  })
  it("'31637' → '31637' (só dígitos)", () => {
    expect(normalizarOab('31637')).toBe('31637')
  })
  it("' 75503a ' → '75503A' (trim de espaços + uppercase)", () => {
    expect(normalizarOab(' 75503a ')).toBe('75503A')
  })
})

describe('hojeSaoPauloISO — data de hoje no fuso America/Sao_Paulo', () => {
  it('retorna no formato YYYY-MM-DD', () => {
    expect(hojeSaoPauloISO()).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })
})
