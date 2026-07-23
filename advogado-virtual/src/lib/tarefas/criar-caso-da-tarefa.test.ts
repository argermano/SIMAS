import { describe, it, expect } from 'vitest'
import { montarCabecalhoPublicacao, montarRelatoCaso } from './criar-caso-da-tarefa'

describe('montarCabecalhoPublicacao', () => {
  it('inclui data (DD/MM) e número mascarado', () => {
    expect(montarCabecalhoPublicacao('2026-07-08', '0001234-56.2024.8.16.0001')).toBe(
      'Caso criado a partir da publicação de 08/07 no processo 0001234-56.2024.8.16.0001.',
    )
  })

  it('sem número: omite "no processo …"', () => {
    expect(montarCabecalhoPublicacao('2026-07-08', null)).toBe(
      'Caso criado a partir da publicação de 08/07.',
    )
  })

  it('sem data: omite "de DD/MM"', () => {
    expect(montarCabecalhoPublicacao(null, '0001234-56.2024.8.16.0001')).toBe(
      'Caso criado a partir da publicação no processo 0001234-56.2024.8.16.0001.',
    )
  })

  it('sem data nem número: só a frase base', () => {
    expect(montarCabecalhoPublicacao(null, null)).toBe('Caso criado a partir da publicação.')
    expect(montarCabecalhoPublicacao(undefined, '   ')).toBe('Caso criado a partir da publicação.')
  })

  it('data mal formada não vira DD/MM', () => {
    expect(montarCabecalhoPublicacao('08/07/2026', null)).toBe('Caso criado a partir da publicação.')
  })
})

describe('montarRelatoCaso — prioridade cache > IA > inteiro teor', () => {
  const cabecalho = 'Caso criado a partir da publicação de 08/07 no processo 0001234-56.2024.8.16.0001.'
  const base = { publicacaoData: '2026-07-08', numeroMascara: '0001234-56.2024.8.16.0001' }

  it('usa o resumo CACHEADO quando presente (ignora IA e teor)', () => {
    const out = montarRelatoCaso({
      ...base,
      resumoCache: 'O Juízo deferiu o levantamento e determinou requerimento próprio.',
      resumoIA: 'resumo da IA',
      inteiroTeor: 'inteiro teor bruto',
    })
    expect(out).toBe(`${cabecalho}\n\nO Juízo deferiu o levantamento e determinou requerimento próprio.`)
  })

  it('sem cache: usa o resumo da IA (ignora o teor)', () => {
    const out = montarRelatoCaso({
      ...base,
      resumoCache: null,
      resumoIA: 'Resumo objetivo em 4 linhas.',
      inteiroTeor: 'inteiro teor bruto',
    })
    expect(out).toBe(`${cabecalho}\n\nResumo objetivo em 4 linhas.`)
  })

  it('sem cache e sem IA: cai no inteiro teor', () => {
    const out = montarRelatoCaso({
      ...base,
      resumoCache: null,
      resumoIA: null,
      inteiroTeor: 'Inteiro teor truncado da publicação.',
    })
    expect(out).toBe(`${cabecalho}\n\nInteiro teor truncado da publicação.`)
  })

  it('trata vazio/whitespace como ausente (pula para a próxima prioridade)', () => {
    const out = montarRelatoCaso({
      ...base,
      resumoCache: '   ',
      resumoIA: '',
      inteiroTeor: 'Teor final.',
    })
    expect(out).toBe(`${cabecalho}\n\nTeor final.`)
  })

  it('sem nenhum insumo ⇒ null (nada a preencher)', () => {
    expect(
      montarRelatoCaso({ ...base, resumoCache: null, resumoIA: null, inteiroTeor: null }),
    ).toBeNull()
    expect(montarRelatoCaso({ ...base })).toBeNull()
  })

  it('cabeçalho degrada sem data/número mas o corpo entra', () => {
    const out = montarRelatoCaso({
      publicacaoData: null,
      numeroMascara: null,
      resumoCache: 'Texto do resumo.',
    })
    expect(out).toBe('Caso criado a partir da publicação.\n\nTexto do resumo.')
  })
})
