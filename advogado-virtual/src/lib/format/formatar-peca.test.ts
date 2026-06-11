import { describe, it, expect } from 'vitest'
import { formatarPeca } from './formatar-peca'

describe('formatarPeca', () => {
  it('converte numeração arábica em romana ALÉM de 20 (toRoman completo)', () => {
    const out = formatarPeca('## 21. DOS PEDIDOS FINAIS')
    expect(out).toContain('XXI')
    expect(out).not.toMatch(/##\s+\**21\./)
  })

  it('converte um título com numeral 4 corretamente (IV, não fallback)', () => {
    const out = formatarPeca('## 4. DO DIREITO')
    expect(out).toContain('IV – DO DIREITO')
  })

  it('substitui expressões proibidas em texto normal', () => {
    const out = formatarPeca('A prova foi obtida através de perícia técnica detalhada.')
    expect(out).toContain('por meio de')
    expect(out).not.toContain('através de')
  })

  it('NÃO altera expressões dentro de citação (blockquote) — preserva a ementa', () => {
    const entrada = [
      'A jurisprudência é clara, conforme se vê:',
      '',
      '> EMENTA: a decisão foi proferida através de votação unânime da turma.',
    ].join('\n')
    const out = formatarPeca(entrada)
    // a linha de citação mantém "através de" intacta
    expect(out).toContain('através de votação unânime')
  })

  it('NÃO adiciona itálico de latim dentro de citação (blockquote)', () => {
    const out = formatarPeca('> "decisão fundada em data venia do relator"')
    // dentro do blockquote, "data venia" não deve ganhar *itálico*
    expect(out).toContain('data venia')
    expect(out).not.toContain('*data venia*')
  })

  it('remove cercas de código ``` que a IA coloca ao redor de seções', () => {
    const entrada = [
      '## I – DOS FATOS',
      '```',
      'O Autor dedicou 45 anos ao trabalho formal.',
      '```',
      '## I.I – DO REQUERIMENTO',
    ].join('\n')
    const out = formatarPeca(entrada)
    expect(out).not.toContain('```')
    expect(out).toContain('O Autor dedicou 45 anos')
  })

  it('NÃO adiciona itálico de latim dentro de TÍTULOS (evita * no heading)', () => {
    const out = formatarPeca('### III.II – DA PROBABILIDADE DO DIREITO (FUMUS BONI IURIS)')
    expect(out).not.toContain('*FUMUS BONI IURIS*')
    expect(out).not.toContain('*fumus boni iuris*')
    expect(out).toContain('FUMUS BONI IURIS')
  })
})
