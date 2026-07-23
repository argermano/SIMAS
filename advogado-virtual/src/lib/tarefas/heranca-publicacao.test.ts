import { describe, it, expect } from 'vitest'
import { decidirVinculoHerdado } from './heranca-publicacao'

describe('decidirVinculoHerdado', () => {
  it('sem processo → null (nada a herdar)', () => {
    expect(decidirVinculoHerdado(null, [])).toBeNull()
    expect(decidirVinculoHerdado(null, ['a1'])).toBeNull()
  })

  it('exatamente 1 caso → vínculo ao CASO (atendimento)', () => {
    expect(decidirVinculoHerdado('p1', ['a1'])).toEqual({ tipo: 'atendimento', id: 'a1' })
  })

  it('0 casos → vínculo ao PROCESSO', () => {
    expect(decidirVinculoHerdado('p1', [])).toEqual({ tipo: 'processo', id: 'p1' })
  })

  it('ambíguo (>1 casos) → vínculo ao PROCESSO (não escolhe por conta própria)', () => {
    expect(decidirVinculoHerdado('p1', ['a1', 'a2'])).toEqual({ tipo: 'processo', id: 'p1' })
  })
})
