import { describe, it, expect } from 'vitest'
import type { SecaoPatch } from '@/lib/diff/patch-secoes'
import { compararSecoes, escolhaPadrao } from '@/lib/diff/secoes'
import { decisoesDaProposta, previaDaProposta, tituloNoDiff, type EscolhaDiff } from './proposta-ui'

const PECA = `## DOS FATOS

Fatos originais.

## DO DIREITO

Direito original.
`

describe('previaDaProposta', () => {
  it('aplica o patch como o servidor aplicaria', () => {
    const r = previaDaProposta(PECA, [
      { titulo: 'DOS FATOS', acao: 'substituir', conteudo_markdown: '## DOS FATOS\n\nFatos novos.' },
    ])
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.markdown).toContain('Fatos novos.')
      expect(r.markdown).toContain('Direito original.')
    }
  })

  it('não derruba a tela quando a seção sumiu da peça', () => {
    const r = previaDaProposta(PECA, [{ titulo: 'DA TUTELA', acao: 'remover' }])
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.titulo).toBe('DA TUTELA')
      expect(r.disponiveis).toContain('DOS FATOS')
    }
  })
})

describe('tituloNoDiff', () => {
  it('usa o alvo em substituir e remover', () => {
    expect(tituloNoDiff({ titulo: 'DOS FATOS', acao: 'substituir', conteudo_markdown: '## DOS FATOS\n\nx' })).toBe('DOS FATOS')
    expect(tituloNoDiff({ titulo: 'DOS FATOS', acao: 'remover' })).toBe('DOS FATOS')
  })

  it('usa o heading do bloco novo nas inserções (a âncora não aparece no diff)', () => {
    expect(
      tituloNoDiff({ titulo: 'DOS FATOS', acao: 'inserir_apos', conteudo_markdown: '## DA TUTELA\n\ntexto' }),
    ).toBe('DA TUTELA')
  })
})

describe('decisoesDaProposta', () => {
  /** Reproduz o caminho real: prévia → comparador → escolhas → decisões. */
  function escolhasDoComparador(patch: SecaoPatch[], trocar: (titulo: string) => 'atual' | 'base' | 'remover' | null): EscolhaDiff[] {
    const previa = previaDaProposta(PECA, patch)
    if (!previa.ok) throw new Error(previa.erro)
    return compararSecoes(PECA, previa.markdown).map((b) => ({
      titulo: b.titulo,
      status: b.status,
      escolha: trocar(b.titulo) ?? escolhaPadrao(b.status),
    }))
  }

  it('aceita tudo quando o advogado não mexe em nada', () => {
    const patch: SecaoPatch[] = [
      { titulo: 'DOS FATOS', acao: 'substituir', conteudo_markdown: '## DOS FATOS\n\nFatos novos.' },
      { titulo: 'DO DIREITO', acao: 'inserir_apos', conteudo_markdown: '## DA TUTELA\n\nUrgência.' },
    ]
    expect(decisoesDaProposta(patch, escolhasDoComparador(patch, () => null))).toEqual([
      { titulo: 'DOS FATOS', decisao: 'aceitar' },
      { titulo: 'DO DIREITO', decisao: 'aceitar' },
    ])
  })

  it('rejeita a seção que o advogado reverteu, mantendo as outras', () => {
    const patch: SecaoPatch[] = [
      { titulo: 'DOS FATOS', acao: 'substituir', conteudo_markdown: '## DOS FATOS\n\nFatos novos.' },
      { titulo: 'DO DIREITO', acao: 'inserir_apos', conteudo_markdown: '## DA TUTELA\n\nUrgência.' },
    ]
    const escolhas = escolhasDoComparador(patch, (t) => (t === 'DOS FATOS' ? 'base' : null))
    expect(decisoesDaProposta(patch, escolhas)).toEqual([
      { titulo: 'DOS FATOS', decisao: 'rejeitar' },
      { titulo: 'DO DIREITO', decisao: 'aceitar' },
    ])
  })

  it('em remover, aceitar é manter a seção fora da peça', () => {
    const patch: SecaoPatch[] = [{ titulo: 'DO DIREITO', acao: 'remover' }]
    expect(decisoesDaProposta(patch, escolhasDoComparador(patch, () => null))).toEqual([
      { titulo: 'DO DIREITO', decisao: 'aceitar' },
    ])
    const restaurada = escolhasDoComparador(patch, () => 'base')
    expect(decisoesDaProposta(patch, restaurada)).toEqual([{ titulo: 'DO DIREITO', decisao: 'rejeitar' }])
  })

  it('operação sem efeito (a peça já estava assim) conta como aceita', () => {
    const patch: SecaoPatch[] = [
      { titulo: 'DOS FATOS', acao: 'substituir', conteudo_markdown: '## DOS FATOS\n\nFatos originais.' },
    ]
    expect(decisoesDaProposta(patch, escolhasDoComparador(patch, () => null))).toEqual([
      { titulo: 'DOS FATOS', decisao: 'aceitar' },
    ])
  })
})
