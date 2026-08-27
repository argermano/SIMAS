import { describe, it, expect } from 'vitest'
import { criarExtratorCampo } from './extrator-campo'
import { CAMPO_RESPOSTA, lerEnvelope } from './envelope'

/** Alimenta o extrator com o JSON quebrado em pedaços de `n` caracteres. */
function porPedacos(json: string, n: number): string {
  const ex = criarExtratorCampo(CAMPO_RESPOSTA)
  let out = ''
  for (let i = 0; i < json.length; i += n) out += ex.consumir(json.slice(i, i + n))
  return out
}

describe('criarExtratorCampo', () => {
  const envelope = {
    resposta_markdown: 'Analisei a peça.\n\n**Dois pontos** merecem ajuste: a data do indeferimento e o pedido "c".',
    proposta: {
      resumo: 'Corrige a data e o pedido.',
      secoes: [{ titulo: 'DOS FATOS', acao: 'substituir', conteudo_markdown: '## DOS FATOS\n\nNovo texto.', motivo: 'data' }],
    },
  }
  const json = JSON.stringify(envelope)

  it('extrai o campo inteiro de um JSON entregue de uma vez', () => {
    const ex = criarExtratorCampo(CAMPO_RESPOSTA)
    expect(ex.consumir(json)).toBe(envelope.resposta_markdown)
    expect(ex.concluido()).toBe(true)
    expect(ex.texto()).toBe(envelope.resposta_markdown)
  })

  it('dá o mesmo resultado com qualquer tamanho de chunk (escapes na fronteira)', () => {
    for (const n of [1, 2, 3, 5, 7, 13, 64, 1000]) {
      expect(porPedacos(json, n)).toBe(envelope.resposta_markdown)
    }
  })

  it('decodifica \\n, aspas e \\uXXXX partidos entre chunks', () => {
    const texto = 'linha 1\nlinha "2"\ncafé — fim'
    const j = JSON.stringify({ resposta_markdown: texto, proposta: null })
    for (const n of [1, 2, 4, 9]) expect(porPedacos(j, n)).toBe(texto)
  })

  it('para nas aspas de fechamento — não vaza o resto do JSON', () => {
    const ex = criarExtratorCampo(CAMPO_RESPOSTA)
    ex.consumir(json)
    expect(ex.texto()).not.toContain('proposta')
    expect(ex.texto()).not.toContain('DOS FATOS')
  })

  it('ignora a chave quando ela aparece só depois (campo ausente = nada emitido)', () => {
    const ex = criarExtratorCampo(CAMPO_RESPOSTA)
    expect(ex.consumir('{"outro_campo":"nada aqui"}')).toBe('')
    expect(ex.concluido()).toBe(false)
    expect(ex.texto()).toBe('')
  })

  it('o texto transmitido bate com o que o parser final lê do envelope', () => {
    const ex = criarExtratorCampo(CAMPO_RESPOSTA)
    ex.consumir(json)
    const { envelope: lido, degradado } = lerEnvelope(json)
    expect(degradado).toBe(false)
    expect(ex.texto()).toBe(lido.resposta_markdown)
    expect(lido.proposta?.secoes).toHaveLength(1)
  })
})

describe('lerEnvelope', () => {
  it('sem proposta, devolve só a resposta', () => {
    const { envelope, degradado } = lerEnvelope(JSON.stringify({ resposta_markdown: 'Sim, a tese se sustenta.' }))
    expect(degradado).toBe(false)
    expect(envelope.proposta).toBeUndefined()
    expect(envelope.resposta_markdown).toBe('Sim, a tese se sustenta.')
  })

  it('proposta com lista vazia de seções não vira proposta', () => {
    const { envelope } = lerEnvelope(JSON.stringify({ resposta_markdown: 'ok', proposta: { resumo: 'x', secoes: [] } }))
    expect(envelope.proposta).toBeUndefined()
  })

  it('texto que não é JSON cai no fallback degradado (nunca perde a rodada)', () => {
    const { envelope, degradado } = lerEnvelope('A peça está boa, sem alterações.')
    expect(degradado).toBe(true)
    expect(envelope.resposta_markdown).toBe('A peça está boa, sem alterações.')
    expect(envelope.proposta).toBeUndefined()
  })

  it('tolera cerca de código em volta do JSON', () => {
    const j = '```json\n' + JSON.stringify({ resposta_markdown: 'ok' }) + '\n```'
    const { envelope, degradado } = lerEnvelope(j)
    expect(degradado).toBe(false)
    expect(envelope.resposta_markdown).toBe('ok')
  })
})
