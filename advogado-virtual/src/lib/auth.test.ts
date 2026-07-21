import { describe, it, expect } from 'vitest'
import { usuarioAtivo } from './auth'

describe('usuarioAtivo — corta acesso de conta desativada', () => {
  it("'ativo' → true", () => {
    expect(usuarioAtivo('ativo')).toBe(true)
  })

  it("'inativo' → false", () => {
    expect(usuarioAtivo('inativo')).toBe(false)
  })

  it('null/undefined → false (barra por precaução)', () => {
    expect(usuarioAtivo(null)).toBe(false)
    expect(usuarioAtivo(undefined)).toBe(false)
  })

  it('qualquer outro valor inesperado → false', () => {
    expect(usuarioAtivo('pendente')).toBe(false)
  })
})
