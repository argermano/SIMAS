import { describe, it, expect } from 'vitest'
import { inferirAreaDoProcesso, ehAreaValida, nomeArea } from './area-inferida'

describe('inferirAreaDoProcesso — mapeamento por órgão/classe/assuntos', () => {
  it('trabalhista: Vara/Juizado do Trabalho', () => {
    expect(inferirAreaDoProcesso({ orgaoJulgador: '2ª Vara do Trabalho de Curitiba' }))
      .toEqual({ area: 'trabalhista', confianca: 'alta' })
    expect(inferirAreaDoProcesso({ orgaoJulgador: 'Juizado Especial do Trabalho' }).area).toBe('trabalhista')
    expect(inferirAreaDoProcesso({ classe: 'Reclamação Trabalhista' }).area).toBe('trabalhista')
  })

  it('previdenciário: INSS, benefício, Vara Previdenciária', () => {
    expect(inferirAreaDoProcesso({ orgaoJulgador: '1ª Vara Previdenciária' }).area).toBe('previdenciario')
    expect(inferirAreaDoProcesso({ assuntos: ['Aposentadoria por Idade (Art. 48/51)'] }).area).toBe('previdenciario')
    expect(inferirAreaDoProcesso({ classe: 'Procedimento Comum', assuntos: ['Auxílio-Doença Previdenciário'] }))
      .toEqual({ area: 'previdenciario', confianca: 'alta' })
    expect(inferirAreaDoProcesso({ assuntos: ['Concessão de benefício do INSS'] }).area).toBe('previdenciario')
  })

  it('família: Vara de Família e assuntos de família', () => {
    expect(inferirAreaDoProcesso({ orgaoJulgador: 'Vara de Família e Sucessões' }).area).toBe('familia')
    expect(inferirAreaDoProcesso({ classe: 'Divórcio Litigioso' }).area).toBe('familia')
    expect(inferirAreaDoProcesso({ assuntos: ['Guarda', 'Alimentos'] }).area).toBe('familia')
    expect(inferirAreaDoProcesso({ classe: 'Inventário' }).area).toBe('familia')
  })

  it('cível: Juizado Especial Cível, Vara Cível, cumprimento de sentença', () => {
    expect(inferirAreaDoProcesso({ orgaoJulgador: '3º Juizado Especial Cível' }).area).toBe('civel')
    expect(inferirAreaDoProcesso({ orgaoJulgador: '1ª Vara Cível' }).area).toBe('civel')
    // Caso real do dono: publicação de cumprimento de sentença na vara cível.
    expect(inferirAreaDoProcesso({ classe: 'Cumprimento de Sentença', orgaoJulgador: '4ª Vara Cível' }))
      .toEqual({ area: 'civel', confianca: 'alta' })
    expect(inferirAreaDoProcesso({ classe: 'Cumprimento de sentença' }).area).toBe('civel')
  })

  it('criminal: matéria/vara criminal', () => {
    expect(inferirAreaDoProcesso({ orgaoJulgador: 'Vara Criminal' }).area).toBe('criminal')
    expect(inferirAreaDoProcesso({ classe: 'Ação Penal' }).area).toBe('criminal')
  })

  it('órgão especializado vence a classe genérica: cumprimento na Vara do Trabalho → trabalhista', () => {
    expect(inferirAreaDoProcesso({ classe: 'Cumprimento de Sentença', orgaoJulgador: '2ª Vara do Trabalho' }).area)
      .toBe('trabalhista')
  })

  it('sem casamento / vazio → área padrão com confiança baixa', () => {
    expect(inferirAreaDoProcesso({})).toEqual({ area: 'civel', confianca: 'baixa' })
    expect(inferirAreaDoProcesso({ classe: 'Procedimento Comum' }).confianca).toBe('baixa')
    expect(inferirAreaDoProcesso({ classe: null, orgaoJulgador: null, assuntos: null }).confianca).toBe('baixa')
  })
})

describe('ehAreaValida', () => {
  it('aceita ids reais de AREAS e rejeita o resto', () => {
    expect(ehAreaValida('civel')).toBe(true)
    expect(ehAreaValida('trabalhista')).toBe(true)
    expect(ehAreaValida('previdenciario')).toBe(true)
    expect(ehAreaValida('inexistente')).toBe(false)
    expect(ehAreaValida(null)).toBe(false)
    expect(ehAreaValida(42)).toBe(false)
  })
})

describe('nomeArea', () => {
  it('devolve o nome amigável ou o id como fallback', () => {
    expect(nomeArea('civel')).toBe('Cível')
    expect(nomeArea('trabalhista')).toBe('Trabalhista')
    expect(nomeArea('desconhecida')).toBe('desconhecida')
  })
})
