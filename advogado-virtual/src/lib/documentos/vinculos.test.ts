import { describe, it, expect } from 'vitest'
import { montarVinculo, agruparVinculosPorDoc, derivarLegado, type VinculoRow } from './vinculos'

const doc = '11111111-1111-1111-1111-111111111111'
const at = '22222222-2222-2222-2222-222222222222'
const proc = '33333333-3333-3333-3333-333333333333'

describe('montarVinculo', () => {
  it('vínculo de caso traz o título (embed objeto)', () => {
    const v = montarVinculo({ documento_id: doc, atendimento_id: at, processo_id: null, atendimentos: { titulo: 'Ação X' } })
    expect(v).toEqual({ atendimento_id: at, processo_id: null, titulo: 'Ação X' })
  })

  it('vínculo de processo traz cnj/apelido (embed array de 1)', () => {
    const v = montarVinculo({ documento_id: doc, atendimento_id: null, processo_id: proc, processos: [{ numero_cnj: '0001', apelido: 'Apelido' }] })
    expect(v).toEqual({ atendimento_id: null, processo_id: proc, numero_cnj: '0001', apelido: 'Apelido' })
  })

  it('sem embed → título/cnj null', () => {
    expect(montarVinculo({ documento_id: doc, atendimento_id: at, processo_id: null })).toEqual({ atendimento_id: at, processo_id: null, titulo: null })
  })

  it('linha sem alvo → null', () => {
    expect(montarVinculo({ documento_id: doc, atendimento_id: null, processo_id: null })).toBeNull()
  })
})

describe('agruparVinculosPorDoc', () => {
  it('o MESMO doc em vários alvos vira uma lista (N:N)', () => {
    const rows: VinculoRow[] = [
      { documento_id: doc, atendimento_id: at, processo_id: null, atendimentos: { titulo: 'Caso' } },
      { documento_id: doc, atendimento_id: null, processo_id: proc, processos: { numero_cnj: '0001', apelido: null } },
    ]
    const mapa = agruparVinculosPorDoc(rows)
    expect(mapa.get(doc)).toHaveLength(2)
  })

  it('doc sem linhas não aparece no mapa (fica geral)', () => {
    expect(agruparVinculosPorDoc([]).has(doc)).toBe(false)
  })
})

describe('derivarLegado', () => {
  it('sem vínculo = tudo null (geral)', () => {
    expect(derivarLegado([])).toEqual({
      atendimento_id: null, atendimento_titulo: null,
      processo_id: null, processo_numero_cnj: null, processo_apelido: null,
    })
  })

  it('pega o 1º de cada tipo quando há vários', () => {
    const legado = derivarLegado([
      { atendimento_id: at, processo_id: null, titulo: 'Caso' },
      { atendimento_id: null, processo_id: proc, numero_cnj: '0001', apelido: 'Ap' },
    ])
    expect(legado.atendimento_id).toBe(at)
    expect(legado.atendimento_titulo).toBe('Caso')
    expect(legado.processo_id).toBe(proc)
    expect(legado.processo_numero_cnj).toBe('0001')
  })
})
