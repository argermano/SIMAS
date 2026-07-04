import { describe, it, expect } from 'vitest'
import { TEMPLATE_POR_AREA } from './index'

// A base REAL de teses vive no banco (teses_escritorio, por tenant) e é testada
// via rota. Aqui só garantimos que os arquivos do repo são apenas TEMPLATE de
// formato — o item de exemplo do previdenciário existe e está marcado `exemplo`.
describe('template de teses no repositório', () => {
  it('previdenciário traz um exemplo/template marcado', () => {
    const exemplos = TEMPLATE_POR_AREA.previdenciario
    expect(exemplos.length).toBeGreaterThan(0)
    expect(exemplos.every((t) => t.exemplo === true)).toBe(true)
  })
})
