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
    // as 5 áreas têm inicial/contestação/réplica/recurso curados, mas não 'agravo'
    expect(selecionarPromptPeca({ area: 'previdenciario', tipo: 'agravo' })).toBeNull()
    expect(selecionarPromptPeca({ area: 'civel', tipo: 'embargos' })).toBeNull()
  })

  it('cobre as 5 áreas curadas com petição inicial e contestação', () => {
    for (const area of ['previdenciario', 'trabalhista', 'civel', 'familia', 'medico']) {
      expect(selecionarPromptPeca({ area, tipo: 'peticao_inicial' })).not.toBeNull()
      expect(selecionarPromptPeca({ area, tipo: 'contestacao' })).not.toBeNull()
    }
  })

  it('cobre a réplica nas 5 áreas curadas', () => {
    for (const area of ['previdenciario', 'trabalhista', 'civel', 'familia', 'medico']) {
      expect(selecionarPromptPeca({ area, tipo: 'replica' })).not.toBeNull()
    }
  })

  it('cobre o recurso de 2º grau correto por área (apelação; RO no trabalhista)', () => {
    // Cível/família/médico/previdenciário: apelação (CPC). Trabalhista: recurso ordinário (CLT).
    for (const area of ['previdenciario', 'civel', 'familia', 'medico']) {
      expect(selecionarPromptPeca({ area, tipo: 'apelacao' })).not.toBeNull()
    }
    expect(selecionarPromptPeca({ area: 'trabalhista', tipo: 'recurso_ordinario' })).not.toBeNull()
    // No trabalhista o recurso contra sentença é o RO, não a apelação
    expect(selecionarPromptPeca({ area: 'trabalhista', tipo: 'apelacao' })).toBeNull()
  })

  it('todo prompt curado expõe system (string) e build (função)', () => {
    for (const tipos of Object.values(PROMPT_MAP)) {
      for (const curado of Object.values(tipos)) {
        expect(typeof curado.system).toBe('string')
        expect(curado.system.length).toBeGreaterThan(0)
        expect(typeof curado.build).toBe('function')
      }
    }
  })
})
