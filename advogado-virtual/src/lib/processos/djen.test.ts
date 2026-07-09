import { describe, it, expect } from 'vitest'
import {
  extrairTextoPlano,
  parseItemDjen,
  classificarPublicacao,
  janelaConsultaDjen,
  montarLinhaPublicacao,
  oabsDoTenant,
  decodeEntidades,
  partesDoMeta,
  advogadoMonitorado,
} from './djen'
import { proximoDiaUtil } from './util'

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
  it('com marca dágua → incremental com overlap de 2 dias', () => {
    const j = janelaConsultaDjen({ djen_ultima_consulta: '2026-07-05' }, '2026-07-07')
    expect(j.backfill).toBe(false)
    expect(j.inicio).toBe('2026-07-03') // marca (05) menos 2 dias de overlap
    expect(j.fim).toBe('2026-07-07')
  })
  it('overlap de 2 dias não escorrega em borda de mês', () => {
    const j = janelaConsultaDjen({ djen_ultima_consulta: '2026-08-01' }, '2026-08-03')
    expect(j.inicio).toBe('2026-07-30')
  })
  it('marca inválida → trata como backfill', () => {
    expect(janelaConsultaDjen({ djen_ultima_consulta: 'ontem' }, '2026-07-07').backfill).toBe(true)
  })
})

describe('djen — mapeamento ItemDjen → linha de publicacoes', () => {
  it('mapeia todos os campos do item para a linha da caixa de entrada', () => {
    const item = parseItemDjen(ITEM_REAL)!
    const linha = montarLinhaPublicacao(item, 'tenant-1', '75503A', 'SC')

    expect(linha.tenant_id).toBe('tenant-1')
    expect(linha.fonte).toBe('djen')
    expect(linha.chave_fonte).toBe('484814173') // id da comunicação, como string
    expect(linha.numero_processo).toBe('00090082820258160026')
    expect(linha.numero_mascara).toBe('0009008-28.2025.8.16.0026')
    expect(linha.sigla_tribunal).toBe('TJPR')
    expect(linha.orgao_julgador).toBe('Vara Cível de Pitanga')
    expect(linha.tipo_comunicacao).toBe('Intimação')
    expect(linha.tipo_documento).toBe('Intimação')
    expect(linha.nome_classe).toBe('Alvará Judicial - Lei 6858/80')
    expect(linha.texto).toBe(ITEM_REAL.texto) // HTML/íntegra crua, não o texto plano
    expect(linha.data_disponibilizacao).toBe('2025-12-19')
    // 2025-12-19 é sexta → próximo dia útil = segunda 2025-12-22 (sem feriados)
    expect(linha.data_publicacao_sugerida).toBe('2025-12-22')
    expect(linha.data_publicacao_sugerida).toBe(proximoDiaUtil('2025-12-19'))
    expect(linha.oab_consultada).toBe('75503A')
    expect(linha.uf_oab).toBe('SC')
    expect(linha.status).toBe('nova')
    expect(linha.meta).toBe(item.raw) // item bruto da API
  })

  it('destinatarios: mapeia raw.destinatarioadvogados (e cai em [] quando ausente)', () => {
    const item = parseItemDjen(ITEM_REAL)!
    expect(montarLinhaPublicacao(item, 'tenant-1', '75503A', 'SC').destinatarios).toEqual([])

    const comDest = parseItemDjen({
      ...ITEM_REAL,
      destinatarioadvogados: [{ advogado: { nome: 'KATLEN', numero_oab: '75503A', uf_oab: 'SC' } }],
    })!
    const linha = montarLinhaPublicacao(comDest, 'tenant-1', '75503A', 'SC')
    expect(linha.destinatarios).toEqual([{ advogado: { nome: 'KATLEN', numero_oab: '75503A', uf_oab: 'SC' } }])
  })
})

describe('djen — OABs monitoradas (fix crítico do sufixo + flag ativa)', () => {
  it('normaliza a OAB do responsável PRESERVANDO o sufixo suplementar', () => {
    const oabs = oabsDoTenant({ oab_numero: '75.503-A', oab_estado: 'sc', config: null })
    expect(oabs).toEqual([{ numero: '75503A', uf: 'SC' }])
  })
  it('inclui extras de config.djen_oabs e ignora as inativas (ativa === false)', () => {
    const oabs = oabsDoTenant({
      oab_numero: '31637',
      oab_estado: 'DF',
      config: {
        djen_oabs: [
          { numero: '75.503-A', uf: 'SC', ativa: true },
          { numero: '99999', uf: 'RS', ativa: false }, // desativada → fora
          { numero: '12345', uf: 'PR' }, // sem flag → ativa por padrão
        ],
      },
    })
    expect(oabs).toEqual([
      { numero: '31637', uf: 'DF' },
      { numero: '75503A', uf: 'SC' },
      { numero: '12345', uf: 'PR' },
    ])
  })
  it('dedup por (numero, uf) — não consulta a mesma inscrição duas vezes', () => {
    const oabs = oabsDoTenant({
      oab_numero: '75503A',
      oab_estado: 'SC',
      config: { djen_oabs: [{ numero: '75.503-A', uf: 'SC' }] },
    })
    expect(oabs).toEqual([{ numero: '75503A', uf: 'SC' }])
  })
})

describe('djen — entidades, partes e advogado (UI estilo Astrea)', () => {
  it('decodifica entidades nomeadas e numéricas', () => {
    expect(decodeEntidades('SENTEN&Ccedil;A N&ordm; &#231;&#227;o')).toBe('SENTENÇA Nº ção')
    expect(decodeEntidades('a&eacute;&iacute;o&otilde;es')).toBe('aéíoões')
    expect(decodeEntidades('&#x41;&#x42;')).toBe('AB')
    expect(decodeEntidades('&naoexiste; fica')).toBe('&naoexiste; fica')
  })
  it('extrairTextoPlano tira tags E decodifica', () => {
    expect(extrairTextoPlano('<b>ATO ORDINAT&Oacute;RIO</b>')).toBe('ATO ORDINATÓRIO')
  })
  it('monta "Autor × Réu" a partir dos polos', () => {
    const meta = { destinatarios: [
      { nome: 'GENI DA SILVA', polo: 'A' },
      { nome: 'BANCO PAN S.A.', polo: 'P' },
    ] }
    expect(partesDoMeta(meta)).toBe('GENI DA SILVA × BANCO PAN S.A.')
  })
  it('agrupa "e outros" quando há mais de 2 no mesmo polo', () => {
    const meta = { destinatarios: [
      { nome: 'ALZIDO SIEBERT', polo: 'P' }, { nome: 'EDSON RINGENBERG', polo: 'P' }, { nome: 'HDI SEGUROS', polo: 'P' },
      { nome: 'GUTCHERO ADRIANO DA COSTA', polo: 'A' },
    ] }
    expect(partesDoMeta(meta)).toBe('GUTCHERO ADRIANO DA COSTA × ALZIDO SIEBERT e outros')
  })
  it('partes: sem destinatarios → null', () => {
    expect(partesDoMeta({})).toBeNull()
    expect(partesDoMeta(null)).toBeNull()
  })
  it('acha o advogado monitorado pela OAB (ignora sufixo/pontuação)', () => {
    const meta = { destinatarioadvogados: [
      { advogado: { nome: 'VANIA PANSIERI', numero_oab: '99999', uf_oab: 'SC' } },
      { advogado: { nome: 'KATLEN SUZAN NARDES GERMANO', numero_oab: '31637', uf_oab: 'DF' } },
    ] }
    expect(advogadoMonitorado(meta, '31637')).toBe('KATLEN SUZAN NARDES GERMANO')
    expect(advogadoMonitorado(meta, '75503A')).toBe('VANIA PANSIERI') // sem match → 1º
  })
})
