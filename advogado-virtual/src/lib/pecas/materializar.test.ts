import { describe, it, expect } from 'vitest'
import { nomeTipoPeca, nomeArquivoPeca, caminhoDocxPeca } from './materializar'

describe('nomeTipoPeca', () => {
  it('usa o nome legível do catálogo de tipos', () => {
    expect(nomeTipoPeca('peticao_inicial')).toBe('Petição Inicial')
  })
  it('faz fallback do slug (underscores viram espaços) p/ tipo desconhecido', () => {
    expect(nomeTipoPeca('tipo_qualquer_novo')).toBe('tipo qualquer novo')
  })
})

describe('nomeArquivoPeca', () => {
  it('monta "Peça — <tipo> — <dd/mm/aaaa>.docx"', () => {
    // Data com componentes locais explícitos (evita salto de fuso).
    const d = new Date(2026, 6, 23) // 23/07/2026
    expect(nomeArquivoPeca('Petição Inicial', d)).toBe('Peça — Petição Inicial — 23/07/2026.docx')
  })
})

describe('caminhoDocxPeca', () => {
  it('sempre prefixa o tenant e é único por peça+instante', () => {
    const path = caminhoDocxPeca('t1', 'c1', 'a1', 'p1', 1700000000000)
    expect(path).toBe('t1/clientes/c1/casos/a1/pecas/p1_1700000000000.docx')
  })

  it('invariante de storage: começa pelo prefixo do tenant e termina em .docx', () => {
    const path = caminhoDocxPeca('tenant-x', 'cli', 'at', 'peca', 42)
    expect(path.startsWith('tenant-x/')).toBe(true)
    expect(path.endsWith('.docx')).toBe(true)
    expect(path).toContain('peca_42')
  })

  it('instantes diferentes → caminhos diferentes (nunca sobrescreve)', () => {
    const a = caminhoDocxPeca('t', 'c', 'at', 'pz', 1)
    const b = caminhoDocxPeca('t', 'c', 'at', 'pz', 2)
    expect(a).not.toBe(b)
  })
})
