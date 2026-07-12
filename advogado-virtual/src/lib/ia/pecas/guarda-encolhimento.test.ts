import { describe, it, expect } from 'vitest'
import { encolhimentoPerigoso } from './guarda-encolhimento'

describe('encolhimentoPerigoso', () => {
  const grande = 'x'.repeat(5000) // teto 70% = 3500 chars

  it('não bloqueia quando o rascunho atual é pequeno (<= 2000)', () => {
    expect(encolhimentoPerigoso('x'.repeat(1500), '')).toBe(false)
    expect(encolhimentoPerigoso('x'.repeat(2000), 'x')).toBe(false)
  })

  it('não bloqueia quando o novo mantém >= 70% do atual', () => {
    expect(encolhimentoPerigoso(grande, 'x'.repeat(3600))).toBe(false) // 72%
    expect(encolhimentoPerigoso(grande, 'x'.repeat(3500))).toBe(false) // exatamente 70%
    expect(encolhimentoPerigoso(grande, 'x'.repeat(6000))).toBe(false) // maior
  })

  it('bloqueia quando o novo encolhe mais de 30%', () => {
    expect(encolhimentoPerigoso(grande, 'x'.repeat(3000))).toBe(true) // 60%
    expect(encolhimentoPerigoso(grande, '')).toBe(true)
  })

  it('não bloqueia peça recém-criada (atual nulo/vazio)', () => {
    expect(encolhimentoPerigoso(null, 'x'.repeat(5000))).toBe(false)
    expect(encolhimentoPerigoso(undefined, 'abc')).toBe(false)
    expect(encolhimentoPerigoso('', 'x'.repeat(5000))).toBe(false)
  })
})
