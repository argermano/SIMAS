import { describe, it, expect } from 'vitest'
import { nomeProvavelDoTitulo } from './titulo-nome'

describe('nomeProvavelDoTitulo', () => {
  it('extrai o cliente à esquerda do " x " (convenção do Astrea)', () => {
    expect(nomeProvavelDoTitulo('MARIA SILVA x INSS: APELAÇÃO. PUB 12/03')).toBe('MARIA SILVA')
    expect(nomeProvavelDoTitulo('JOÃO x EMPRESA LTDA: CONTRARRAZÕES. PUB 03/04')).toBe('JOÃO')
    expect(nomeProvavelDoTitulo('cliente x parte: ALEGAÇÕES FINAIS')).toBe('cliente')
  })

  it('descarta índice/pontuação inicial', () => {
    expect(nomeProvavelDoTitulo('12. MARIA x INSS: APELAÇÃO')).toBe('MARIA')
    expect(nomeProvavelDoTitulo('- FULANO DE TAL x MUNICÍPIO: EMENDA')).toBe('FULANO DE TAL')
  })

  it('título sem " x " → null (sem sugestão)', () => {
    expect(nomeProvavelDoTitulo('Apresentar contrarrazões ao recurso interposto')).toBeNull()
    expect(nomeProvavelDoTitulo('CONTESTAÇÃO')).toBeNull()
    expect(nomeProvavelDoTitulo('')).toBeNull()
    expect(nomeProvavelDoTitulo(null)).toBeNull()
  })

  it('não casa "x" grudado em palavra (Max, 9x12)', () => {
    expect(nomeProvavelDoTitulo('Max Verstappen: peça')).toBeNull()
    expect(nomeProvavelDoTitulo('foto 9x12 do cliente')).toBeNull()
  })

  it('parte esquerda curta/sem letras → null', () => {
    expect(nomeProvavelDoTitulo('ré x autor: CONTESTAÇÃO')).toBeNull() // "ré" = 2 letras
    expect(nomeProvavelDoTitulo('123 x 456: algo')).toBeNull()
  })

  it('limita a 120 caracteres', () => {
    const nomeLongo = 'A'.repeat(200)
    expect(nomeProvavelDoTitulo(`${nomeLongo} x parte: peça`)).toHaveLength(120)
  })
})
