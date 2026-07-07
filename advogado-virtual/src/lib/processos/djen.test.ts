import { describe, it, expect } from 'vitest'
import { extrairTextoPlano, parseItemDjen, classificarPublicacao, janelaConsultaDjen } from './djen'

// Shape real verificado em produção (comunicaapi.pje.jus.br, processo da Marta)
const ITEM_REAL: Record<string, unknown> = {
  id: 484814173,
  numero_processo: '00090082820258160026',
  numeroprocessocommascara: '0009008-28.2025.8.16.0026',
  siglaTribunal: 'TJPR',
  tipoComunicacao: 'Intimação',
  tipoDocumento: 'Intimação',
  nomeOrgao: 'Vara Cível de Pitanga',
  nomeClasse: 'Alvará Judicial - Lei 6858/80',
  data_disponibilizacao: '2025-12-19',
  link: 'https://projudi.tjpr.jus.br/projudi/processo/validacaoDocumentos.do?_tj=x',
  texto: 'Intimação referente ao movimento (seq. 49) JUNTADA DE PETIÇÃO DE MANIFESTAÇÃO DA PARTE (10/12/2025). Acesse o sistema Projudi.',
}

describe('djen — parse do item da API Comunica', () => {
  it('parseia o shape real de produção', () => {
    const p = parseItemDjen(ITEM_REAL)
    expect(p).not.toBeNull()
    expect(p!.id).toBe(484814173)
    expect(p!.numero).toBe('00090082820258160026')
    expect(p!.tribunal).toBe('TJPR')
    expect(p!.data).toBe('2025-12-19')
    expect(p!.textoPlano).toContain('JUNTADA DE PETIÇÃO')
  })

  it('rejeita itens sem id/número/data válidos', () => {
    expect(parseItemDjen({})).toBeNull()
    expect(parseItemDjen({ id: 1, numero_processo: '123', data_disponibilizacao: '2026-01-01' })).toBeNull()
    expect(parseItemDjen({ id: 1, numero_processo: '00090082820258160026' })).toBeNull()
  })
})

describe('djen — texto plano', () => {
  it('remove tags e entidades HTML', () => {
    const t = extrairTextoPlano('<p>Julgo <b>PROCEDENTE</b> o pedido.</p><br>Assinado&nbsp;digitalmente')
    expect(t).toContain('Julgo PROCEDENTE o pedido.')
    expect(t).toContain('Assinado digitalmente')
    expect(t).not.toMatch(/<|&nbsp;/)
    expect(extrairTextoPlano(null)).toBe('')
  })
})

describe('djen — classificação pela substância', () => {
  it('intimação de juntada → movimentação comum (não notifica por padrão)', () => {
    expect(classificarPublicacao({ tipoDocumento: 'Intimação', textoPlano: 'Intimação referente ao movimento JUNTADA DE PETIÇÃO' }))
      .toBe('movimentacao_comum')
  })
  it('publicação de sentença → sentenca (notifica por padrão)', () => {
    expect(classificarPublicacao({ tipoDocumento: 'Sentença', textoPlano: 'Julgo procedente o pedido...' }))
      .toBe('sentenca')
    expect(classificarPublicacao({ tipoDocumento: 'Intimação', textoPlano: 'Intimação da SENTENÇA de procedência proferida nos autos' }))
      .toBe('sentenca')
  })
  it('sem match → fallback publicacao', () => {
    expect(classificarPublicacao({ tipoDocumento: 'Comunicado xyz', textoPlano: 'qqq www' })).toBe('publicacao')
  })
})

describe('djen — janela de consulta (anti-retroativo)', () => {
  it('sem marca dágua → backfill de 30 dias (silencioso)', () => {
    const j = janelaConsultaDjen(null, '2026-07-07')
    expect(j.backfill).toBe(true)
    expect(j.inicio).toBe('2026-06-07')
    expect(j.fim).toBe('2026-07-07')
  })
  it('com marca dágua → incremental com overlap de 1 dia', () => {
    const j = janelaConsultaDjen({ djen_ultima_consulta: '2026-07-05' }, '2026-07-07')
    expect(j.backfill).toBe(false)
    expect(j.inicio).toBe('2026-07-04')
    expect(j.fim).toBe('2026-07-07')
  })
  it('marca inválida → trata como backfill', () => {
    expect(janelaConsultaDjen({ djen_ultima_consulta: 'ontem' }, '2026-07-07').backfill).toBe(true)
  })
})
