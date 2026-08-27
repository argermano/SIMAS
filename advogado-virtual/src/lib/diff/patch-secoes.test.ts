import { describe, it, expect } from 'vitest'
import { aplicarPatchSecoes, descreverPatch, PatchSecaoError, type SecaoPatch } from './patch-secoes'
import { dividirSecoes } from './secoes'

const PECA = `# EXCELENTÍSSIMO SENHOR DOUTOR JUIZ

João da Silva propõe a presente ação.

## DOS FATOS

O autor teve o pedido indeferido em 10/01/2024.

## DO DIREITO

Aplica-se a Lei 8.213/1991.

## DOS PEDIDOS

a) a procedência integral do pedido.`

describe('aplicarPatchSecoes — substituir', () => {
  it('troca só a seção alvo e preserva as demais byte a byte', () => {
    const { markdown, aplicadas } = aplicarPatchSecoes(PECA, [
      { titulo: 'DOS FATOS', acao: 'substituir', conteudo_markdown: '## DOS FATOS\n\nNova narrativa dos fatos.' },
    ])

    expect(aplicadas).toBe(1)
    expect(markdown).toContain('Nova narrativa dos fatos.')
    expect(markdown).not.toContain('indeferido em 10/01/2024')
    // As outras seções continuam idênticas.
    expect(markdown).toContain('Aplica-se a Lei 8.213/1991.')
    expect(markdown).toContain('a) a procedência integral do pedido.')
    // E a ordem das seções não muda.
    expect(dividirSecoes(markdown).map((s) => s.titulo)).toEqual([
      'EXCELENTÍSSIMO SENHOR DOUTOR JUIZ', 'DOS FATOS', 'DO DIREITO', 'DOS PEDIDOS',
    ])
  })

  it('casa o título ignorando caixa e pontuação', () => {
    const { aplicadas } = aplicarPatchSecoes(PECA, [
      { titulo: 'dos fatos:', acao: 'substituir', conteudo_markdown: '## DOS FATOS\n\nOutra narrativa.' },
    ])
    expect(aplicadas).toBe(1)
  })
})

describe('aplicarPatchSecoes — inserir_apos', () => {
  it('insere a seção nova logo depois da âncora', () => {
    const { markdown } = aplicarPatchSecoes(PECA, [
      { titulo: 'DOS FATOS', acao: 'inserir_apos', conteudo_markdown: '## DA TUTELA DE URGÊNCIA\n\nPresentes os requisitos.' },
    ])

    expect(dividirSecoes(markdown).map((s) => s.titulo)).toEqual([
      'EXCELENTÍSSIMO SENHOR DOUTOR JUIZ',
      'DOS FATOS',
      'DA TUTELA DE URGÊNCIA',
      'DO DIREITO',
      'DOS PEDIDOS',
    ])
    // Costura: linha em branco entre a seção anterior e a nova.
    expect(markdown).toContain('indeferido em 10/01/2024.\n\n## DA TUTELA DE URGÊNCIA')
    expect(markdown).toContain('Presentes os requisitos.\n\n## DO DIREITO')
  })
})

describe('aplicarPatchSecoes — remover', () => {
  it('remove a seção e mantém o resto', () => {
    const { markdown, aplicadas } = aplicarPatchSecoes(PECA, [
      { titulo: 'DO DIREITO', acao: 'remover' },
    ])
    expect(aplicadas).toBe(1)
    expect(markdown).not.toContain('Aplica-se a Lei 8.213/1991.')
    expect(dividirSecoes(markdown).map((s) => s.titulo)).toEqual([
      'EXCELENTÍSSIMO SENHOR DOUTOR JUIZ', 'DOS FATOS', 'DOS PEDIDOS',
    ])
  })

  it('reaplicar levanta erro claro — a seção já não existe', () => {
    const { markdown } = aplicarPatchSecoes(PECA, [{ titulo: 'DO DIREITO', acao: 'remover' }])
    expect(() => aplicarPatchSecoes(markdown, [{ titulo: 'DO DIREITO', acao: 'remover' }]))
      .toThrow(PatchSecaoError)
  })
})

describe('aplicarPatchSecoes — inserir_inicio', () => {
  it('coloca o bloco no topo do documento', () => {
    const { markdown } = aplicarPatchSecoes(PECA, [
      { titulo: '', acao: 'inserir_inicio', conteudo_markdown: '## ENDEREÇAMENTO\n\nAo Juízo da 1ª Vara.' },
    ])
    expect(markdown.startsWith('## ENDEREÇAMENTO')).toBe(true)
    expect(dividirSecoes(markdown)[1].titulo).toBe('EXCELENTÍSSIMO SENHOR DOUTOR JUIZ')
  })

  it('funciona sobre peça vazia', () => {
    const { markdown } = aplicarPatchSecoes('', [
      { titulo: '', acao: 'inserir_inicio', conteudo_markdown: '## PRIMEIRA SEÇÃO\n\nTexto.' },
    ])
    expect(markdown).toBe('## PRIMEIRA SEÇÃO\n\nTexto.')
  })
})

describe('aplicarPatchSecoes — título inexistente', () => {
  it('erro claro, com a lista de seções disponíveis', () => {
    const patch: SecaoPatch[] = [{ titulo: 'DA PRESCRIÇÃO', acao: 'substituir', conteudo_markdown: '## DA PRESCRIÇÃO\n\nx' }]
    expect(() => aplicarPatchSecoes(PECA, patch)).toThrow(/Seção "DA PRESCRIÇÃO" não encontrada/)
    expect(() => aplicarPatchSecoes(PECA, patch)).toThrow(/DOS PEDIDOS/)
    try {
      aplicarPatchSecoes(PECA, patch)
    } catch (e) {
      expect(e).toBeInstanceOf(PatchSecaoError)
      expect((e as PatchSecaoError).status).toBe(409)
      expect((e as PatchSecaoError).acao).toBe('substituir')
      expect((e as PatchSecaoError).disponiveis).toContain('DO DIREITO')
    }
  })

  it('inserir_apos com âncora inexistente também levanta', () => {
    expect(() => aplicarPatchSecoes(PECA, [
      { titulo: 'DA INEXISTENTE', acao: 'inserir_apos', conteudo_markdown: '## NOVA\n\nx' },
    ])).toThrow(PatchSecaoError)
  })
})

describe('aplicarPatchSecoes — idempotência', () => {
  const patch: SecaoPatch[] = [
    { titulo: 'DOS FATOS', acao: 'substituir', conteudo_markdown: '## DOS FATOS\n\nNarrativa revista.' },
    { titulo: 'DO DIREITO', acao: 'inserir_apos', conteudo_markdown: '## DA TUTELA\n\nRequisitos presentes.' },
    { titulo: '', acao: 'inserir_inicio', conteudo_markdown: '## ENDEREÇAMENTO\n\nAo Juízo.' },
  ]

  it('aplicar duas vezes dá o mesmo texto (nada duplica)', () => {
    const uma = aplicarPatchSecoes(PECA, patch)
    const duas = aplicarPatchSecoes(uma.markdown, patch)
    expect(duas.markdown).toBe(uma.markdown)
    expect(duas.aplicadas).toBe(0)
    expect(duas.ignoradas).toBe(3)
    // E a seção nova aparece UMA vez só.
    expect(uma.markdown.match(/## DA TUTELA/g)).toHaveLength(1)
    expect(duas.markdown.match(/## DA TUTELA/g)).toHaveLength(1)
  })

  it('bloco novo com mais de um heading também não duplica', () => {
    const p: SecaoPatch[] = [{
      titulo: 'DOS FATOS',
      acao: 'inserir_apos',
      conteudo_markdown: '## DA TUTELA\n\nRequisitos.\n\n## DO PERIGO\n\nRisco.',
    }]
    const uma = aplicarPatchSecoes(PECA, p)
    const duas = aplicarPatchSecoes(uma.markdown, p)
    expect(duas.markdown).toBe(uma.markdown)
    expect(uma.markdown.match(/## DO PERIGO/g)).toHaveLength(1)
  })
})

describe('aplicarPatchSecoes — casos de borda', () => {
  it('patch vazio devolve o texto intacto', () => {
    expect(aplicarPatchSecoes(PECA, []).markdown).toBe(PECA)
  })

  it('conteúdo vazio em substituir é ignorado (não apaga a seção)', () => {
    const { markdown, aplicadas, ignoradas } = aplicarPatchSecoes(PECA, [
      { titulo: 'DOS FATOS', acao: 'substituir', conteudo_markdown: '   ' },
    ])
    expect(aplicadas).toBe(0)
    expect(ignoradas).toBe(1)
    expect(markdown).toBe(PECA)
  })

  it('várias operações em sequência mantêm os índices corretos', () => {
    const { markdown } = aplicarPatchSecoes(PECA, [
      { titulo: 'DOS FATOS', acao: 'inserir_apos', conteudo_markdown: '## DA TUTELA\n\nA.' },
      { titulo: 'DOS PEDIDOS', acao: 'substituir', conteudo_markdown: '## DOS PEDIDOS\n\nb) novo pedido.' },
      { titulo: 'DO DIREITO', acao: 'remover' },
    ])
    expect(dividirSecoes(markdown).map((s) => s.titulo)).toEqual([
      'EXCELENTÍSSIMO SENHOR DOUTOR JUIZ', 'DOS FATOS', 'DA TUTELA', 'DOS PEDIDOS',
    ])
    expect(markdown).toContain('b) novo pedido.')
  })
})

describe('descreverPatch', () => {
  it('descreve a proposta sem expor o conteúdo das seções', () => {
    const texto = descreverPatch([
      { titulo: 'DOS FATOS', acao: 'substituir', conteudo_markdown: 'SEGREDO', motivo: 'corrigir a data' },
      { titulo: 'DO DIREITO', acao: 'inserir_apos', conteudo_markdown: 'SEGREDO' },
    ])
    expect(texto).toBe('- substituir "DOS FATOS" — corrigir a data\n- inserir depois de "DO DIREITO"')
    expect(texto).not.toContain('SEGREDO')
  })
})
