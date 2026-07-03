import { describe, it, expect } from 'vitest'
import { dividirSecoes, compararSecoes, montarMarkdown, escolhaPadrao } from './secoes'

const BASE = `# Petição
Preâmbulo.

## Dos Fatos
O autor trabalhou de 2005 a 2020.

## Do Direito
Aplica-se a Lei 8.213/91.

## Dos Pedidos
Procedência.`

describe('dividirSecoes', () => {
  it('separa por heading e mantém o preâmbulo', () => {
    const s = dividirSecoes(BASE)
    expect(s.map((x) => x.titulo)).toEqual(['Petição', 'Dos Fatos', 'Do Direito', 'Dos Pedidos'])
    expect(s[1].conteudo).toContain('2005 a 2020')
  })
})

describe('compararSecoes', () => {
  it('marca seção alterada, adicionada e removida', () => {
    const atual = `# Petição
Preâmbulo.

## Dos Fatos
O autor trabalhou de 2005 a 2021 em condições especiais.

## Do Direito
Aplica-se a Lei 8.213/91.

## Da Tutela de Urgência
Presentes os requisitos.`
    const blocos = compararSecoes(BASE, atual)
    const porTitulo = Object.fromEntries(blocos.map((b) => [b.titulo, b.status]))
    expect(porTitulo['Dos Fatos']).toBe('alterada')
    expect(porTitulo['Do Direito']).toBe('igual')
    expect(porTitulo['Da Tutela de Urgência']).toBe('adicionada')
    expect(porTitulo['Dos Pedidos']).toBe('removida')
  })

  it('documentos idênticos → todas iguais', () => {
    const blocos = compararSecoes(BASE, BASE)
    expect(blocos.every((b) => b.status === 'igual')).toBe(true)
  })
})

describe('montarMarkdown', () => {
  it('escolhas padrão reconstroem o documento atual (round-trip)', () => {
    const atual = BASE.replace('2005 a 2020', '2005 a 2021')
    const blocos = compararSecoes(BASE, atual)
    const escolhas = blocos.map((b) => escolhaPadrao(b.status))
    expect(montarMarkdown(blocos, escolhas).trim()).toBe(atual.trim())
  })

  it('reverter uma seção usa o conteúdo da base', () => {
    const atual = BASE.replace('2005 a 2020', '2005 a 2021')
    const blocos = compararSecoes(BASE, atual)
    const escolhas = blocos.map((b) => (b.titulo === 'Dos Fatos' ? 'base' : escolhaPadrao(b.status)) as ReturnType<typeof escolhaPadrao>)
    const out = montarMarkdown(blocos, escolhas)
    expect(out).toContain('2005 a 2020')
    expect(out).not.toContain('2005 a 2021')
  })

  it('remover uma seção adicionada a tira do resultado', () => {
    const atual = BASE + '\n\n## Extra\nConteúdo novo.'
    const blocos = compararSecoes(BASE, atual)
    const escolhas = blocos.map((b) => (b.titulo === 'Extra' ? 'remover' : escolhaPadrao(b.status)) as ReturnType<typeof escolhaPadrao>)
    expect(montarMarkdown(blocos, escolhas)).not.toContain('Conteúdo novo')
  })
})
