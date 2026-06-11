import { describe, it, expect } from 'vitest'
import mammoth from 'mammoth'
import { markdownToDocx, limparMarkdownParaDocx } from './docx-generator'

describe('limparMarkdownParaDocx', () => {
  it('remove cercas de código ``` (inclusive as internas)', () => {
    const out = limparMarkdownParaDocx('## I – DOS FATOS\n```\nO Autor...\n```\ntexto')
    expect(out).not.toContain('```')
    expect(out).toContain('O Autor...')
  })

  it('desescapa colchetes/pontuação do editor (\\[ → [)', () => {
    const out = limparMarkdownParaDocx('portador do CPF n. \\[PREENCHER\\], em \\[PREENCHER COMARCA\\]')
    expect(out).toContain('[PREENCHER]')
    expect(out).toContain('[PREENCHER COMARCA]')
    expect(out).not.toContain('\\[')
  })

  it('preserva marcadores de formatação (* e **)', () => {
    const out = limparMarkdownParaDocx('texto **negrito** e *itálico*')
    expect(out).toContain('**negrito**')
    expect(out).toContain('*itálico*')
  })

  it('remove indentação que viraria bloco de código (fonte monoespaçada)', () => {
    const out = limparMarkdownParaDocx('## I – DOS FATOS\n    O Autor reside em tal lugar.\n\tCom contribuições.')
    expect(out).toMatch(/^O Autor reside/m)   // sem os 4 espaços iniciais
    expect(out).toMatch(/^Com contribuições/m) // sem o tab inicial
    expect(out).not.toMatch(/^ {4}/m)
    expect(out).not.toMatch(/^\t/m)
  })

  it('converte links markdown de e-mail/URL em texto puro', () => {
    const out = limparMarkdownParaDocx('e-mail [lico@gmail.com](mailto:lico@gmail.com) e site [aqui](https://x.com)')
    expect(out).toContain('lico@gmail.com')
    expect(out).not.toContain('mailto:')
    expect(out).not.toContain('](')
    expect(out).toContain('aqui')
  })
})

describe('markdownToDocx — artefatos não vazam para o documento', () => {
  // Reproduz os defeitos vistos no PDF real (Petição Inicial)
  const markdown = [
    '## I – DOS FATOS',
    '```',
    'O autor reside em \\[PREENCHER endereço completo\\], CEP \\[PREENCHER\\].',
    '```',
    '### III.II – DA PROBABILIDADE DO DIREITO (*FUMUS BONI IURIS*)',
    'Resta demonstrado o direito.',
  ].join('\n')

  it('não contém crases triplas, colchetes escapados nem asteriscos de título', async () => {
    const buffer = await markdownToDocx(markdown)
    const { value } = await mammoth.extractRawText({ buffer })
    expect(value).not.toContain('```')
    expect(value).not.toContain('\\[')
    expect(value).not.toContain('*FUMUS BONI IURIS*')
    expect(value).toContain('FUMUS BONI IURIS')
    expect(value).toContain('[PREENCHER]')
    expect(value).toContain('[PREENCHER endereço completo]')
  })

  it('endereçamento ao juízo sai em negrito', async () => {
    const buffer = await markdownToDocx(
      'EXCELENTÍSSIMO SENHOR JUIZ FEDERAL DE [PREENCHER COMARCA]\n\nFULANO DE TAL, brasileiro, propõe a presente ação.',
    )
    const { value } = await mammoth.convertToHtml({ buffer })
    expect(value).toMatch(/<strong>[^<]*EXCELENT[IÍ]SSIMO/i)
  })
})
