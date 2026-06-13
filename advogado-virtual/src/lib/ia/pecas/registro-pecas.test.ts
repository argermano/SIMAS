import { describe, it, expect } from 'vitest'
import { selecionarPromptPeca, PROMPT_MAP } from './registro-pecas'

describe('selecionarPromptPeca', () => {
  it('retorna o prompt curado para combinações (área, tipo) mapeadas', () => {
    const prev = selecionarPromptPeca({ area: 'previdenciario', tipo: 'peticao_inicial' })
    expect(prev).not.toBeNull()
    expect(typeof prev?.system).toBe('string')
    expect(typeof prev?.build).toBe('function')

    const trab = selecionarPromptPeca({ area: 'trabalhista', tipo: 'contestacao' })
    expect(trab).not.toBeNull()
    expect(trab).toBe(PROMPT_MAP.trabalhista.contestacao)
  })

  it('retorna null para área sem prompt curado (cai no genérico)', () => {
    expect(selecionarPromptPeca({ area: 'criminal', tipo: 'peticao_inicial' })).toBeNull()
    expect(selecionarPromptPeca({ area: 'tributario', tipo: 'contestacao' })).toBeNull()
  })

  it('retorna null para tipo de peça sem curadoria na área', () => {
    // previdenciário tem petição inicial e contestação curadas, mas não 'apelacao'
    expect(selecionarPromptPeca({ area: 'previdenciario', tipo: 'apelacao' })).toBeNull()
  })

  it('cobre as 5 áreas curadas com petição inicial e contestação', () => {
    for (const area of ['previdenciario', 'trabalhista', 'civel', 'familia', 'medico']) {
      expect(selecionarPromptPeca({ area, tipo: 'peticao_inicial' })).not.toBeNull()
      expect(selecionarPromptPeca({ area, tipo: 'contestacao' })).not.toBeNull()
    }
  })
})
