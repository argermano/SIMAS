import { describe, it, expect } from 'vitest'
import { destinatariosNovaTarefa } from './destinatarios'

describe('destinatariosNovaTarefa — dedupe e exclusão do autor', () => {
  it('junta responsável + envolvidos', () => {
    expect(
      destinatariosNovaTarefa({ assigneeId: 'a', envolvidos: ['b', 'c'] }),
    ).toEqual(['a', 'b', 'c'])
  })

  it('deduplica (responsável também listado como envolvido)', () => {
    expect(
      destinatariosNovaTarefa({ assigneeId: 'a', envolvidos: ['a', 'b', 'b'] }),
    ).toEqual(['a', 'b'])
  })

  it('exclui quem executou a ação (criador não se auto-avisa)', () => {
    expect(
      destinatariosNovaTarefa({ assigneeId: 'a', envolvidos: ['b', 'c'], excluir: 'a' }),
    ).toEqual(['b', 'c'])
    // o autor também some quando aparece só entre os envolvidos
    expect(
      destinatariosNovaTarefa({ assigneeId: 'a', envolvidos: ['autor', 'b'], excluir: 'autor' }),
    ).toEqual(['a', 'b'])
  })

  it('remove nulos/undefined e preserva a ordem de primeira aparição', () => {
    expect(
      destinatariosNovaTarefa({ assigneeId: null, envolvidos: [undefined, 'b', null, 'a', 'b'] }),
    ).toEqual(['b', 'a'])
  })

  it('só o próprio criador como responsável → nenhum destinatário', () => {
    expect(destinatariosNovaTarefa({ assigneeId: 'a', envolvidos: [], excluir: 'a' })).toEqual([])
  })
})
