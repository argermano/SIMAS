import { describe, it, expect } from 'vitest'
import {
  JANELA_EDICAO_MS,
  JANELA_MATCH_ACERVO_MS,
  acharWaidNoAcervo,
  normalizarTextoComparacao,
  podeEditar,
  restanteEdicaoMs,
  waIdDoSourceId,
  type LinhaAcervoMatch,
  semAssinaturaDeAgente,
} from './edicao'
import type { Mensagem } from './tipos'

/** Instante de referência das idades (epoch ms) e o mesmo em segundos. */
const AGORA_MS = 1_700_000_000_000
const AGORA_S = AGORA_MS / 1000

/** Mensagem de SAÍDA, texto puro — o caso editável; sobrescreva o que interessa. */
function msg(p: Partial<Mensagem> = {}): Mensagem {
  return {
    id: 1,
    direcao: 'saida',
    privada: false,
    conteudo: 'Bom dia, seguem os documentos',
    anexos: [],
    sender: { tipo: 'agente', nome: 'Solange' },
    timestamp: AGORA_S,
    ...p,
  }
}

describe('podeEditar — janela de 14 minutos', () => {
  it('aceita a mensagem recém-enviada', () => {
    expect(podeEditar(msg(), AGORA_MS)).toBe(true)
  })

  it('aceita DENTRO da janela (13 min)', () => {
    expect(podeEditar(msg({ timestamp: AGORA_S - 13 * 60 }), AGORA_MS)).toBe(true)
  })

  it('aceita no LIMITE exato (14 min cravados)', () => {
    const noLimite = AGORA_MS - JANELA_EDICAO_MS
    expect(podeEditar(msg({ timestamp: noLimite / 1000 }), AGORA_MS)).toBe(true)
  })

  it('recusa 1 ms além do limite', () => {
    const passou = AGORA_MS - JANELA_EDICAO_MS - 1
    expect(podeEditar(msg({ timestamp: passou / 1000 }), AGORA_MS)).toBe(false)
  })

  it('recusa mensagem antiga (1 hora)', () => {
    expect(podeEditar(msg({ timestamp: AGORA_S - 3600 }), AGORA_MS)).toBe(false)
  })

  it('a margem é menor que os ~15 min do WhatsApp', () => {
    expect(JANELA_EDICAO_MS).toBeLessThan(15 * 60_000)
  })
})

describe('podeEditar — o que o WhatsApp não deixa corrigir', () => {
  it('recusa mensagem de ENTRADA (do cliente)', () => {
    expect(podeEditar(msg({ direcao: 'entrada' }), AGORA_MS)).toBe(false)
  })

  it('recusa atividade do sistema', () => {
    expect(podeEditar(msg({ direcao: 'atividade' }), AGORA_MS)).toBe(false)
  })

  it('recusa nota interna (privada)', () => {
    expect(podeEditar(msg({ privada: true }), AGORA_MS)).toBe(false)
  })

  it('recusa mensagem com ANEXO (mídia com legenda não é editável)', () => {
    const comAnexo = msg({ anexos: [{ tipo: 'image', url: 'https://x/y.jpg' }] })
    expect(podeEditar(comAnexo, AGORA_MS)).toBe(false)
  })

  it('recusa mensagem sem texto (nada a corrigir)', () => {
    expect(podeEditar(msg({ conteudo: '' }), AGORA_MS)).toBe(false)
    expect(podeEditar(msg({ conteudo: '   ' }), AGORA_MS)).toBe(false)
  })

  it('recusa timestamp ausente/torto em vez de oferecer o botão', () => {
    expect(podeEditar(msg({ timestamp: NaN }), AGORA_MS)).toBe(false)
    expect(podeEditar(msg({ timestamp: null as unknown as number }), AGORA_MS)).toBe(false)
  })
})

describe('restanteEdicaoMs', () => {
  it('devolve a janela cheia na mensagem do instante', () => {
    expect(restanteEdicaoMs(msg(), AGORA_MS)).toBe(JANELA_EDICAO_MS)
  })

  it('devolve negativo depois de a janela fechar', () => {
    expect(restanteEdicaoMs(msg({ timestamp: AGORA_S - 20 * 60 }), AGORA_MS)).toBeLessThan(0)
  })
})

describe('waIdDoSourceId', () => {
  it('extrai o key.id do formato WAID:<id> da ponte nativa', () => {
    expect(waIdDoSourceId('WAID:3EB0C767D82B0B3A1234')).toBe('3EB0C767D82B0B3A1234')
  })

  it('tolera prefixo em outro caixa e espaços em volta', () => {
    expect(waIdDoSourceId('  waid:ABC123  ')).toBe('ABC123')
  })

  it('devolve null para source_id sem WAID, vazio, nulo ou só com o prefixo', () => {
    expect(waIdDoSourceId('cw:8891')).toBeNull()
    expect(waIdDoSourceId('')).toBeNull()
    expect(waIdDoSourceId(null)).toBeNull()
    expect(waIdDoSourceId(undefined)).toBeNull()
    expect(waIdDoSourceId('WAID:   ')).toBeNull()
  })
})

describe('normalizarTextoComparacao', () => {
  it('colapsa espaços e quebras de linha e apara as pontas', () => {
    expect(normalizarTextoComparacao('  Bom   dia\n\nequipe  ')).toBe('Bom dia equipe')
  })

  it('trata nulo/indefinido como vazio', () => {
    expect(normalizarTextoComparacao(null)).toBe('')
    expect(normalizarTextoComparacao(undefined)).toBe('')
  })
})

describe('acharWaidNoAcervo — casamento por conteúdo + tempo', () => {
  const CRIADA = '2026-08-04T12:00:00.000Z'

  function linha(p: Partial<LinhaAcervoMatch> = {}): LinhaAcervoMatch {
    return {
      mensagem_id: 'WA1',
      texto: 'Bom dia, seguem os documentos',
      timestamp_msg: CRIADA,
      de_mim: true,
      tipo: 'texto',
      ...p,
    }
  }

  const alvo = { conteudo: 'Bom dia, seguem os documentos', criadaEmIso: CRIADA }

  it('acha a linha correspondente', () => {
    expect(acharWaidNoAcervo([linha()], alvo)).toBe('WA1')
  })

  it('casa mesmo com espaçamento diferente dos dois lados', () => {
    const l = linha({ texto: 'Bom dia,   seguem\nos documentos' })
    expect(acharWaidNoAcervo([l], { ...alvo, conteudo: '  Bom dia, seguem os documentos ' })).toBe('WA1')
  })

  it('ignora entrada do cliente, mídia e texto diferente', () => {
    expect(acharWaidNoAcervo([linha({ de_mim: false })], alvo)).toBeNull()
    expect(acharWaidNoAcervo([linha({ tipo: 'imagem' })], alvo)).toBeNull()
    expect(acharWaidNoAcervo([linha({ texto: 'outra coisa' })], alvo)).toBeNull()
  })

  it('ignora a linha fora da tolerância de 10 min', () => {
    const longe = new Date(Date.parse(CRIADA) + JANELA_MATCH_ACERVO_MS + 1000).toISOString()
    expect(acharWaidNoAcervo([linha({ timestamp_msg: longe })], alvo)).toBeNull()
  })

  it('aceita a linha no limite exato da tolerância', () => {
    const limite = new Date(Date.parse(CRIADA) + JANELA_MATCH_ACERVO_MS).toISOString()
    expect(acharWaidNoAcervo([linha({ timestamp_msg: limite })], alvo)).toBe('WA1')
  })

  it('empate (mesmo texto duas vezes) → vence a de MENOR |Δt|', () => {
    const base = Date.parse(CRIADA)
    const longe = linha({ mensagem_id: 'LONGE', timestamp_msg: new Date(base - 240_000).toISOString() })
    const perto = linha({ mensagem_id: 'PERTO', timestamp_msg: new Date(base + 3_000).toISOString() })
    expect(acharWaidNoAcervo([longe, perto], alvo)).toBe('PERTO')
    expect(acharWaidNoAcervo([perto, longe], alvo)).toBe('PERTO')
  })

  it('sem candidata devolve null (nunca "quase certo")', () => {
    expect(acharWaidNoAcervo([], alvo)).toBeNull()
    expect(acharWaidNoAcervo([linha({ mensagem_id: '' })], alvo)).toBeNull()
  })

  it('alvo sem texto ou com data inválida devolve null', () => {
    expect(acharWaidNoAcervo([linha()], { ...alvo, conteudo: '  ' })).toBeNull()
    expect(acharWaidNoAcervo([linha()], { ...alvo, criadaEmIso: 'nao-e-data' })).toBeNull()
  })

  it('ignora linha com timestamp ilegível sem derrubar a busca', () => {
    const ruim = linha({ mensagem_id: 'RUIM', timestamp_msg: 'xx' })
    expect(acharWaidNoAcervo([ruim, linha()], alvo)).toBe('WA1')
  })

  // Caso real (BOM DIA, 2026-08-10): o eco do WhatsApp chega com a assinatura
  // do agente que o content do Chatwoot não tem.
  it('casa eco com assinatura de agente na frente', () => {
    const assinado = linha({ texto: '*Katlen Germano:*\nBom dia, seguem os documentos' })
    expect(acharWaidNoAcervo([assinado], alvo)).toBe('WA1')
  })

  it('assinatura só é ignorada no INÍCIO — no meio do texto não casa', () => {
    const meio = linha({ texto: 'Bom dia\n*Katlen Germano:*\nseguem os documentos' })
    expect(acharWaidNoAcervo([meio], alvo)).toBeNull()
  })
})

describe('semAssinaturaDeAgente', () => {
  it('remove a assinatura padrão do Chatwoot', () => {
    expect(semAssinaturaDeAgente('*Katlen Germano:*\nBOM DIA')).toBe('BOM DIA')
  })
  it('não mexe em texto sem assinatura ou com negrito legítimo no meio', () => {
    expect(semAssinaturaDeAgente('BOM DIA')).toBe('BOM DIA')
    expect(semAssinaturaDeAgente('Veja *isto:* aqui')).toBe('Veja *isto:* aqui')
  })
  it('remove UMA assinatura só (nunca duas linhas)', () => {
    expect(semAssinaturaDeAgente('*A:*\n*B:*\ntexto')).toBe('*B:*\ntexto')
  })
})
