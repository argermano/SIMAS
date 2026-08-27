import { describe, it, expect } from 'vitest'
import { separarDecisoes, statusDaProposta } from './decidir'
import type { SecaoPatch } from '@/lib/diff/patch-secoes'

const PATCH: SecaoPatch[] = [
  { titulo: 'DOS FATOS', acao: 'substituir', conteudo_markdown: '## DOS FATOS\n\nA.' },
  { titulo: 'DO DIREITO', acao: 'substituir', conteudo_markdown: '## DO DIREITO\n\nB.' },
  { titulo: 'DOS PEDIDOS', acao: 'remover' },
]

describe('separarDecisoes', () => {
  it('aceitarTudo aceita todas as seções', () => {
    const { aceitas, rejeitadas } = separarDecisoes(PATCH, { aceitarTudo: true })
    expect(aceitas).toHaveLength(3)
    expect(rejeitadas).toHaveLength(0)
  })

  it('rejeitarTudo não aceita nenhuma', () => {
    const { aceitas, mapa } = separarDecisoes(PATCH, { rejeitarTudo: true })
    expect(aceitas).toHaveLength(0)
    expect(mapa['DOS FATOS']).toBe('rejeitar')
  })

  it('decisões por título, casando sem depender de caixa e pontuação', () => {
    const { aceitas, rejeitadas } = separarDecisoes(PATCH, {
      decisoes: [
        { titulo: 'dos fatos:', decisao: 'aceitar' },
        { titulo: 'DO DIREITO', decisao: 'rejeitar' },
      ],
    })
    expect(aceitas.map((a) => a.titulo)).toEqual(['DOS FATOS'])
    expect(rejeitadas.map((r) => r.titulo)).toEqual(['DO DIREITO', 'DOS PEDIDOS'])
  })

  it('seção sem decisão explícita é REJEITADA (silêncio nunca altera a peça)', () => {
    const { aceitas, mapa } = separarDecisoes(PATCH, { decisoes: [{ titulo: 'DOS FATOS', decisao: 'aceitar' }] })
    expect(aceitas).toHaveLength(1)
    expect(mapa['DOS PEDIDOS']).toBe('rejeitar')
  })
})

describe('statusDaProposta', () => {
  it('nenhuma aceita = rejeitada; todas = aceita; algumas = parcial', () => {
    expect(statusDaProposta(3, 0)).toBe('rejeitada')
    expect(statusDaProposta(3, 3)).toBe('aceita')
    expect(statusDaProposta(3, 1)).toBe('parcial')
  })
})
