import { describe, it, expect } from 'vitest'
import { validarTransicao, montarDescricaoTarefa } from './triagem'

describe('validarTransicao — toda ação de triagem parte de "nova"', () => {
  it('nova + triada → ok, alvo "triada"', () => {
    expect(validarTransicao('nova', 'triada')).toEqual({ ok: true, novoStatus: 'triada' })
  })
  it('nova + descartar → ok, alvo "descartada"', () => {
    expect(validarTransicao('nova', 'descartar')).toEqual({ ok: true, novoStatus: 'descartada' })
  })
  it('nova + tarefa → ok, alvo "tarefa_criada"', () => {
    expect(validarTransicao('nova', 'tarefa')).toEqual({ ok: true, novoStatus: 'tarefa_criada' })
  })

  it('rejeita quando já "triada"', () => {
    const r = validarTransicao('triada', 'tarefa')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.motivo).toBeTruthy()
  })
  it('rejeita quando já "descartada"', () => {
    expect(validarTransicao('descartada', 'triada').ok).toBe(false)
  })
  it('rejeita quando já "tarefa_criada"', () => {
    expect(validarTransicao('tarefa_criada', 'descartar').ok).toBe(false)
  })
  it('rejeita status desconhecido', () => {
    expect(validarTransicao('qualquer', 'triada').ok).toBe(false)
  })
})

describe('montarDescricaoTarefa — "Publicação {tipo} — proc. {nº} ({tribunal})"', () => {
  it('com número, tipo_documento e tribunal', () => {
    expect(
      montarDescricaoTarefa({
        tipo_documento: 'Intimação',
        tipo_comunicacao: 'Comunicação',
        numero_mascara: '0801234-56.2026.8.16.0001',
        sigla_tribunal: 'TJPR',
      }),
    ).toBe('Publicação Intimação — proc. 0801234-56.2026.8.16.0001 (TJPR)')
  })

  it('sem número de processo (edital) → "proc. não informado"', () => {
    expect(
      montarDescricaoTarefa({
        tipo_documento: 'Edital',
        numero_mascara: null,
        sigla_tribunal: 'TJSC',
      }),
    ).toBe('Publicação Edital — proc. não informado (TJSC)')
  })

  it('número vazio/só espaços conta como sem número', () => {
    expect(
      montarDescricaoTarefa({ tipo_documento: 'Despacho', numero_mascara: '   ', sigla_tribunal: 'TRF4' }),
    ).toBe('Publicação Despacho — proc. não informado (TRF4)')
  })

  it('sem tipo_documento cai no tipo_comunicacao', () => {
    expect(
      montarDescricaoTarefa({
        tipo_documento: null,
        tipo_comunicacao: 'Intimação',
        numero_mascara: '123',
        sigla_tribunal: 'TJDF',
      }),
    ).toBe('Publicação Intimação — proc. 123 (TJDF)')
  })

  it('sem tipo algum usa "sem tipo"; sem tribunal omite o sufixo', () => {
    expect(
      montarDescricaoTarefa({ tipo_documento: null, tipo_comunicacao: null, numero_mascara: '123', sigla_tribunal: null }),
    ).toBe('Publicação sem tipo — proc. 123')
  })
})
