import { describe, it, expect } from 'vitest'
import {
  blocoDocumentosSessao,
  documentoGrande,
  historicoParaMensagens,
  montarPrefixoContexto,
  montarRodada,
  montarTurnoDaRodada,
  MIN_HISTORICO_PRESERVADO,
  tamanhoMensagens,
  type DocumentoSessao,
} from './montagem'
import { MAX_CHARS_POR_DOC } from '@/lib/prompts/pecas/_shared/qualificacao'
import type { ContextoPeca } from '@/lib/ia/pecas/contexto'
import type { MensagemIA } from '@/lib/anthropic/client'

const doc = (over: Partial<DocumentoSessao> = {}): DocumentoSessao => ({
  id: 'doc-1',
  file_name: 'cnis.pdf',
  tipo: 'CNIS',
  texto_extraido: 'Vínculos: Empresa Alfa (2005-2010).',
  ...over,
})

const ctxFake = (): ContextoPeca => ({
  system: 'SYSTEM CURADO',
  promptBase: '',
  documentosContexto: [],
  meta: {
    atendimentoId: 'at-1',
    area: 'previdenciario',
    tipo: 'peticao_inicial',
    curado: true,
    qualificacao: { autor: { nome: 'João da Silva', cpf: '123.456.789-00' } },
    localizacao: {},
    modeloPadrao: null,
    jurisprudenciaTexto: '',
    blocoFundamentacao: '',
    totalDocumentos: 1,
    documentosRelevantes: 1,
    triagemAplicada: false,
  },
})

describe('blocoDocumentosSessao', () => {
  it('documento pequeno entra inteiro', () => {
    const bloco = blocoDocumentosSessao([doc()])
    expect(bloco).toContain('Vínculos: Empresa Alfa (2005-2010).')
    expect(bloco).not.toContain('RESUMO')
  })

  it('documento grande entra como RESUMO com aviso de íntegra disponível', () => {
    const grande = doc({ texto_extraido: 'A'.repeat(MAX_CHARS_POR_DOC + 1), resumo_ia: 'Ficha financeira 2019-2024.' })
    expect(documentoGrande(grande)).toBe(true)
    const bloco = blocoDocumentosSessao([grande])
    expect(bloco).toContain('RESUMO')
    expect(bloco).toContain('Ficha financeira 2019-2024.')
    expect(bloco).toContain('íntegra disponível')
    // O texto integral NÃO vai no prompt quando há resumo.
    expect(bloco.length).toBeLessThan(1_000)
  })

  it('documento grande SEM resumo é truncado com marca (nunca some do prompt)', () => {
    const grande = doc({ texto_extraido: 'B'.repeat(MAX_CHARS_POR_DOC + 5_000) + 'FIM' })
    const bloco = blocoDocumentosSessao([grande])
    expect(bloco).toContain('truncado em')
    expect(bloco).not.toContain('FIM')
  })

  it('marca o que o advogado anexou nesta sessão', () => {
    expect(blocoDocumentosSessao([doc({ anexado: true })])).toContain('ANEXADO PELO ADVOGADO NESTA SESSÃO')
  })

  it('dossiê vazio não quebra', () => {
    expect(blocoDocumentosSessao([])).toContain('Nenhum documento')
  })
})

describe('montarPrefixoContexto', () => {
  it('é determinístico (o cache de prompt depende disso)', () => {
    const args = { ctx: ctxFake(), documentos: [doc()], areaNome: 'Previdenciário', tipoNome: 'Petição inicial' }
    expect(montarPrefixoContexto(args)).toBe(montarPrefixoContexto(args))
  })

  it('traz qualificação e documentos, e não traz a peça', () => {
    const texto = montarPrefixoContexto({
      ctx: ctxFake(), documentos: [doc()], areaNome: 'Previdenciário', tipoNome: 'Petição inicial',
    })
    expect(texto).toContain('João da Silva')
    expect(texto).toContain('cnis.pdf')
    expect(texto).toContain('MATERIAL DO CASO')
    expect(texto).not.toContain('PEÇA ATUAL')
  })

  it('sem contexto do caso, ainda monta o bloco', () => {
    const texto = montarPrefixoContexto({ ctx: null, documentos: [], areaNome: 'Cível', tipoNome: 'Réplica' })
    expect(texto).toContain('Não disponível')
  })
})

describe('montarTurnoDaRodada', () => {
  const peca = '# CABEÇALHO\n\ntexto\n\n## DOS FATOS\n\nfatos\n\n## DOS PEDIDOS\n\npedidos'

  it('junta peça atual, títulos das seções e instrução — nessa ordem', () => {
    const turno = montarTurnoDaRodada({ pecaAtual: peca, versao: 3, instrucao: 'Reforce a tutela.' })
    expect(turno).toContain('PEÇA ATUAL (versão 3)')
    expect(turno.indexOf('## DOS FATOS')).toBeLessThan(turno.indexOf('INSTRUÇÃO DO ADVOGADO'))
    expect(turno).toContain('- DOS FATOS')
    expect(turno).toContain('- DOS PEDIDOS')
    // A instrução é a última coisa do prompt (depois do último breakpoint de cache).
    expect(turno.trimEnd().endsWith('Reforce a tutela.')).toBe(true)
  })

  it('peça sem seções com título avisa em vez de listar vazio', () => {
    expect(montarTurnoDaRodada({ pecaAtual: 'texto solto', versao: 1, instrucao: 'x' }))
      .toContain('a peça ainda não tem seções com título')
  })
})

describe('historicoParaMensagens', () => {
  it('mapeia papéis e ignora turnos sem blocos', () => {
    const msgs = historicoParaMensagens([
      { papel: 'sistema', blocos: null },
      { papel: 'advogado', blocos: ['Ajuste os pedidos.'] },
      { papel: 'agente', blocos: ['Ajustei o pedido "c".', 'Proposta: substituir DOS PEDIDOS'] },
      { papel: 'sistema', blocos: ['O advogado aceitou 1 de 2 seções.'] },
      { papel: 'agente', blocos: [] },
    ])
    expect(msgs).toHaveLength(3)
    expect(msgs[0]).toEqual({ role: 'user', content: 'Ajuste os pedidos.' })
    expect(msgs[1].role).toBe('assistant')
    expect(msgs[1].content).toContain('Proposta: substituir DOS PEDIDOS')
    expect(msgs[2].role).toBe('user')
    expect(msgs[2].content).toContain('[registro do sistema]')
  })
})

describe('montarRodada', () => {
  const base = {
    system: 'SYSTEM',
    prefixoContexto: 'CONTEXTO DO CASO',
    turnoAtual: 'PEÇA + INSTRUÇÃO',
  }

  it('ordena contexto → histórico → rodada', () => {
    const { messages } = montarRodada({
      ...base,
      historico: [{ role: 'user', content: 'a' }, { role: 'assistant', content: 'b' }],
    })
    expect(messages.map((m) => m.content)).toEqual(['CONTEXTO DO CASO', 'a', 'b', 'PEÇA + INSTRUÇÃO'])
    expect(messages[0].role).toBe('user')
  })

  it('não corta nada quando cabe no teto', () => {
    const r = montarRodada({ ...base, historico: [{ role: 'user', content: 'a' }] })
    expect(r.cortadas).toBe(0)
    expect(r.chars).toBe('SYSTEM'.length + 'CONTEXTO DO CASO'.length + 1 + 'PEÇA + INSTRUÇÃO'.length)
  })

  it('compacta o histórico ANTIGO quando estoura o teto, preservando as últimas trocas', () => {
    const historico: MensagemIA[] = Array.from({ length: 12 }, (_, i) => ({
      role: i % 2 === 0 ? 'user' : 'assistant',
      content: `turno ${i} `.padEnd(100, 'x'),
    }))
    const r = montarRodada({ ...base, historico, teto: 700 })
    expect(r.cortadas).toBeGreaterThan(0)
    expect(r.historico.length).toBeGreaterThanOrEqual(MIN_HISTORICO_PRESERVADO)
    // As últimas trocas continuam lá; as primeiras é que saíram.
    expect(r.historico[r.historico.length - 1].content).toContain('turno 11')
    expect(r.messages[0].content).toBe('CONTEXTO DO CASO')
    expect(r.messages[r.messages.length - 1].content).toBe('PEÇA + INSTRUÇÃO')
  })

  it('nunca corta o contexto nem a rodada — se não couber, o tamanho é reportado como está', () => {
    const r = montarRodada({
      system: 'S',
      prefixoContexto: 'C'.repeat(5_000),
      turnoAtual: 'T'.repeat(5_000),
      historico: [],
      teto: 100,
    })
    expect(r.cortadas).toBe(0)
    expect(r.chars).toBeGreaterThan(100)
    expect(tamanhoMensagens(r.messages)).toBe(10_000)
  })
})
