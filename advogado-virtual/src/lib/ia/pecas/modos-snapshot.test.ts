import { describe, it, expect } from 'vitest'
import { montarPromptDoModo, anexarModeloEJurisprudencia } from './motor'
import type { ContextoPeca } from './contexto'
import { SYSTEM_MODO_REFINAR, buildPromptModoRefinar } from '@/lib/prompts/pecas/_shared/modo-refinar'
import { SYSTEM_MODO_CORRIGIR, buildPromptModoCorrigir } from '@/lib/prompts/pecas/_shared/modo-corrigir'
import { MAX_CHARS_POR_DOC } from '@/lib/prompts/pecas/_shared/qualificacao'

// Snapshots dos MODOS do motor único (F0.2). Complementam
// prompts-snapshot.test.ts (que trava os 40 prompts curados, intocados aqui):
// estes travam o texto dos blocos MOVIDOS das rotas para src/lib —
// SYSTEM_REFINAMENTO (refinamento-peca) → SYSTEM_MODO_REFINAR e o SYSTEM +
// instruções de correção (correcao-auto) → modo-corrigir — e a COMPOSIÇÃO de
// cada modo. Se um snapshot mudar sem intenção, o teste falha.

const PECA_ATUAL = `# EXCELENTÍSSIMO SENHOR DOUTOR JUIZ

João da Silva, brasileiro, propõe a presente ação.

## DOS FATOS
O autor teve seu pedido administrativo indeferido em 10/01/2024.

## DOS PEDIDOS
a) a procedência integral do pedido.`

const DOCUMENTOS = [
  { tipo: 'CNIS', texto_extraido: 'Vínculos: Empresa Alfa Ltda (2005-2010).', file_name: 'cnis.pdf' },
  { tipo: 'documento_pessoal', texto_extraido: 'João da Silva, CPF 123.456.789-00.', file_name: 'rg.png' },
  // Documento sem texto útil: fica de fora do prompt de refino (como no original).
  { tipo: 'outro', texto_extraido: '   ', file_name: 'vazio.pdf' },
]

function ctxFake(over: Partial<ContextoPeca> = {}, meta: Partial<ContextoPeca['meta']> = {}): ContextoPeca {
  return {
    system: 'SYSTEM CURADO DA ÁREA (fixture)',
    promptBase: 'PROMPT BASE DA PEÇA (fixture)',
    documentosContexto: DOCUMENTOS.map((d, i) => ({ id: `doc-${i}`, ...d })),
    meta: {
      atendimentoId: 'atendimento-1',
      area: 'previdenciario',
      tipo: 'peticao_inicial',
      curado: true,
      qualificacao: { autor: { nome: 'João da Silva' } },
      localizacao: { cidade: 'Campinas', estado: 'SP' },
      modeloPadrao: null,
      jurisprudenciaTexto: '',
      blocoFundamentacao: '',
      totalDocumentos: 3,
      documentosRelevantes: 3,
      triagemAplicada: true,
      ...meta,
    },
    ...over,
  }
}

describe('modo corrigir (texto movido de correcao-auto)', () => {
  it('system estável', () => {
    expect(SYSTEM_MODO_CORRIGIR).toMatchSnapshot('system')
  })

  for (const tipo of ['remover_citacao', 'completar_item', 'ajustar_pedido', 'tipo_desconhecido']) {
    it(`prompt estável — ${tipo}`, () => {
      expect(buildPromptModoCorrigir(PECA_ATUAL, tipo)).toMatchSnapshot('prompt')
    })
  }

  it('montarPromptDoModo compõe o modo sem exigir contexto do caso', () => {
    const { system, prompt } = montarPromptDoModo('corrigir', null, {
      pecaAtual: PECA_ATUAL,
      tipoCorrecao: 'ajustar_pedido',
    })
    expect(system).toBe(SYSTEM_MODO_CORRIGIR)
    expect(prompt).toBe(buildPromptModoCorrigir(PECA_ATUAL, 'ajustar_pedido'))
  })
})

describe('modo refinar (texto movido de refinamento-peca)', () => {
  it('system estável', () => {
    expect(SYSTEM_MODO_REFINAR).toMatchSnapshot('system')
  })

  it('prompt estável', () => {
    expect(buildPromptModoRefinar({
      areaNome: 'Previdenciário',
      pecaAtual: PECA_ATUAL,
      documentos: DOCUMENTOS,
      instrucoes: 'Reforce a fundamentação do período especial e corrija as datas pelo CNIS.',
    })).toMatchSnapshot('prompt')
  })

  it('sem instrução e sem documentos, o prompt encolhe para peça + tarefa', () => {
    expect(buildPromptModoRefinar({
      areaNome: 'Cível',
      pecaAtual: PECA_ATUAL,
      documentos: [],
    })).toMatchSnapshot('prompt-minimo')
  })

  it('trunca documento gigante no orçamento por documento (guarda contra 413)', () => {
    const prompt = buildPromptModoRefinar({
      areaNome: 'Trabalhista',
      pecaAtual: PECA_ATUAL,
      documentos: [{ tipo: 'holerites', texto_extraido: 'A'.repeat(MAX_CHARS_POR_DOC + 5_000) + 'FIM_DO_DOCUMENTO', file_name: 'holerites.pdf' }],
    })
    expect(prompt).toContain('documento truncado em')
    expect(prompt).not.toContain('FIM_DO_DOCUMENTO')
    expect(prompt.length).toBeLessThan(MAX_CHARS_POR_DOC + 3_000)
  })

  it('com prompt curado, o system é o curado + o bloco do modo', () => {
    const ctx = ctxFake()
    const { system } = montarPromptDoModo('refinar', ctx, { pecaAtual: PECA_ATUAL, instrucao: 'x' })
    expect(system).toBe(`${ctx.system}\n\n${SYSTEM_MODO_REFINAR}`)
  })

  it('sem prompt curado (peça colada de fora), o system é só o do modo — como antes', () => {
    const ctx = ctxFake({}, { curado: false, tipo: 'refinamento' })
    const { system } = montarPromptDoModo('refinar', ctx, { pecaAtual: PECA_ATUAL, instrucao: 'x' })
    expect(system).toBe(SYSTEM_MODO_REFINAR)
  })

  it('composição do modo refinar estável', () => {
    const { prompt } = montarPromptDoModo('refinar', ctxFake({}, { area: 'medico' }), {
      pecaAtual: PECA_ATUAL,
      instrucao: 'Inclua o dano moral autônomo.',
    })
    expect(prompt).toMatchSnapshot('prompt-composto')
  })
})

describe('modo criar (composição extraída de gerar-peca)', () => {
  it('é exatamente promptBase + modelo/jurisprudência + fundamentação', () => {
    const ctx = ctxFake({}, {
      modeloPadrao: 'MODELO DO ESCRITÓRIO (fixture)',
      jurisprudenciaTexto: 'JURISPRUDÊNCIA (fixture)',
      blocoFundamentacao: '\n\n## FUNDAMENTAÇÃO VERIFICADA PELO ESCRITÓRIO\n(fixture)',
    })
    const { system, prompt } = montarPromptDoModo('criar', ctx)

    expect(system).toBe(ctx.system)
    // Reprodução literal do que a rota gerar-peca fazia inline antes do F0.2.
    expect(prompt).toBe(
      anexarModeloEJurisprudencia(ctx.promptBase, {
        modeloPadrao: ctx.meta.modeloPadrao,
        jurisprudenciaTexto: ctx.meta.jurisprudenciaTexto,
      }) + ctx.meta.blocoFundamentacao,
    )
    expect(prompt).toMatchSnapshot('prompt')
  })

  it('sem modelo, sem jurisprudência e sem teses, o prompt é o promptBase puro', () => {
    const ctx = ctxFake()
    expect(montarPromptDoModo('criar', ctx).prompt).toBe(ctx.promptBase)
  })

  it('exige o contexto do caso', () => {
    expect(() => montarPromptDoModo('criar', null)).toThrow(/exige o contexto do caso/)
  })
})
