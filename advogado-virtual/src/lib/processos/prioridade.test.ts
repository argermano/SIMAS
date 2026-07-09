import { describe, it, expect } from 'vitest'
import { prioridadeDaCategoria, CATEGORIAS } from './categorias'

// Prioridade é hint de RELEVÂNCIA (categoria curada), NUNCA prazo processual.
describe('categorias — prioridade de relevância por categoria', () => {
  it('alta: atos que decidem/encerram/recorrem', () => {
    expect(prioridadeDaCategoria('sentenca')).toBe('alta')
    expect(prioridadeDaCategoria('transito_julgado')).toBe('alta')
    expect(prioridadeDaCategoria('recurso')).toBe('alta')
    expect(prioridadeDaCategoria('arquivamento')).toBe('alta')
  })

  it('media: atos que pedem atenção sem decidir o mérito de imediato', () => {
    expect(prioridadeDaCategoria('audiencia')).toBe('media')
    expect(prioridadeDaCategoria('expedicao_alvara')).toBe('media')
    expect(prioridadeDaCategoria('decisao_despacho')).toBe('media')
    expect(prioridadeDaCategoria('publicacao')).toBe('media')
  })

  it('baixa: trâmite comum e categoria ausente (null)', () => {
    expect(prioridadeDaCategoria('movimentacao_comum')).toBe('baixa')
    expect(prioridadeDaCategoria('redistribuicao')).toBe('baixa')
    expect(prioridadeDaCategoria(null)).toBe('baixa')
  })

  it('cobre TODAS as categorias curadas com um nível válido', () => {
    for (const c of CATEGORIAS) {
      expect(['alta', 'media', 'baixa']).toContain(prioridadeDaCategoria(c.slug))
    }
  })
})
