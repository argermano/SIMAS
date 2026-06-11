import { describe, it, expect } from 'vitest'
import { categorizar, LIMITES_PLANO, mensagemCotaExcedida } from './quota'

describe('categorizar', () => {
  it('mapeia endpoints fixos para a própria chave', () => {
    expect(categorizar('gerar_peca').chave).toBe('gerar_peca')
    expect(categorizar('analise_geral').chave).toBe('analise_geral')
    expect(categorizar('validar_peca').chave).toBe('validar_peca')
  })

  it('agrupa comando_* por prefixo', () => {
    expect(categorizar('comando_resumir').chave).toBe('comando')
    expect(categorizar('comando_traduzir').chave).toBe('comando')
  })

  it('agrupa correcao_* por prefixo', () => {
    expect(categorizar('correcao_ortografia').chave).toBe('correcao')
  })

  it('endpoint desconhecido cai em "Outros" com a própria chave', () => {
    const r = categorizar('endpoint_inexistente')
    expect(r.grupo).toBe('Outros')
    expect(r.chave).toBe('endpoint_inexistente')
  })
})

describe('LIMITES_PLANO', () => {
  it('trial é mais restrito que profissional', () => {
    expect(LIMITES_PLANO.trial.gerar_peca).toBeLessThan(LIMITES_PLANO.profissional.gerar_peca)
  })
  it('todos os planos definem as categorias principais', () => {
    for (const plano of ['trial', 'basico', 'profissional']) {
      expect(LIMITES_PLANO[plano].gerar_peca).toBeGreaterThan(0)
      expect(LIMITES_PLANO[plano].analise).toBeGreaterThan(0)
    }
  })
})

describe('mensagemCotaExcedida', () => {
  it('inclui plano, uso e limite', () => {
    const msg = mensagemCotaExcedida({ permitido: false, limite: 50, usados: 50, chave: 'gerar_peca', plano: 'trial' })
    expect(msg).toContain('trial')
    expect(msg).toContain('50')
  })
})
