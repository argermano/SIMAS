import { describe, it, expect } from 'vitest'
import { montarDocumentosContexto } from './contexto'

describe('montarDocumentosContexto', () => {
  it('descarta docs sem texto extraído (null, undefined ou só espaços)', () => {
    const r = montarDocumentosContexto([
      { file_name: 'a.pdf', tipo: 'rg_cpf', texto_extraido: 'conteúdo' },
      { file_name: 'b.pdf', tipo: 'cnis', texto_extraido: null },
      { file_name: 'c.pdf', tipo: 'ctps' },
      { file_name: 'd.pdf', tipo: 'outro', texto_extraido: '   ' },
    ])
    expect(r).toEqual([{ tipo: 'rg_cpf', texto_extraido: 'conteúdo', file_name: 'a.pdf' }])
  })

  it('junta múltiplos grupos (upload + do cadastro) preservando a ordem', () => {
    const r = montarDocumentosContexto(
      [{ file_name: 'up.pdf', tipo: 'ctps', texto_extraido: 'x' }],
      [{ file_name: 'cad.pdf', tipo: 'rg_cpf', texto_extraido: 'y' }],
    )
    expect(r.map((d) => d.file_name)).toEqual(['up.pdf', 'cad.pdf'])
  })

  it('deduplica por tipo+nome entre grupos e apara o texto', () => {
    const r = montarDocumentosContexto(
      [{ file_name: 'igual.pdf', tipo: 'cnis', texto_extraido: '  texto  ' }],
      [{ file_name: 'igual.pdf', tipo: 'cnis', texto_extraido: 'repetido' }],
    )
    expect(r).toEqual([{ tipo: 'cnis', texto_extraido: 'texto', file_name: 'igual.pdf' }])
  })

  it('sem docs = array vazio', () => {
    expect(montarDocumentosContexto([], [])).toEqual([])
  })
})
