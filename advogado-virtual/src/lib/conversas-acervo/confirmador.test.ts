import { describe, it, expect } from 'vitest'
import {
  casarMensagens,
  coberturaDoIndice,
  compativel,
  direcaoRelayDe,
  extrairMarcador,
  marcadorDaMensagem,
  mensagemNossaDaLinha,
  normalizarMensagensChatwoot,
  normalizarPrefixo,
  pisoDaLeitura,
  tamanhoAproximado,
  tipoMidiaCompativel,
  TOLERANCIA_MS,
  type MensagemChatwoot,
  type MensagemNossa,
} from './confirmador'

// Lógica PURA do confirmador (083 / plano Conversas Próprias, Etapa 1).
// É aqui que se decide "esta mensagem chegou ao Chatwoot?" — errar para o lado
// do "não chegou" duplica mensagem para o CLIENTE, então cada regra tem teste.

const T0 = Date.parse('2026-07-27T12:00:00.000Z')

function nossa(over: Partial<MensagemNossa> = {}): MensagemNossa {
  return {
    id: 'n1',
    mensagemId: 'EVO1',
    deMim: false,
    tipo: 'texto',
    texto: 'bom dia doutora',
    timestampMs: T0,
    mediaTamanho: null,
    temMedia: false,
    ...over,
  }
}

function cw(over: Partial<MensagemChatwoot> = {}): MensagemChatwoot {
  return {
    id: 1,
    timestampMs: T0,
    direcao: 'entrada',
    privada: false,
    conteudo: 'bom dia doutora',
    anexos: [],
    marcador: null,
    ...over,
  }
}

/** Atalho de mídia sem texto (o caso real: PDF encaminhado sem legenda). */
function nossaPdf(over: Partial<MensagemNossa> = {}): MensagemNossa {
  return nossa({ tipo: 'documento', texto: null, temMedia: true, mediaTamanho: 120_000, ...over })
}
function cwPdf(over: Partial<MensagemChatwoot> = {}): MensagemChatwoot {
  return cw({ conteudo: '', anexos: [{ tipo: 'file', tamanho: null }], ...over })
}

describe('normalizarPrefixo', () => {
  it('ignora acento, caixa, pontuação e espaços repetidos', () => {
    expect(normalizarPrefixo('Bom  dia, Doutora!')).toBe(normalizarPrefixo('bom dia doutora'))
    expect(normalizarPrefixo('Ação Trabalhista')).toBe('acao trabalhista')
  })

  it('compara só o começo — texto truncado de um lado ainda casa', () => {
    const inteiro = 'preciso muito falar com a doutora sobre o processo'
    const cortado = 'preciso muito falar com a doutora'
    expect(normalizarPrefixo(inteiro)).toBe(normalizarPrefixo(cortado))
  })

  it('texto vazio/nulo vira string vazia (nunca casa por acidente)', () => {
    expect(normalizarPrefixo(null)).toBe('')
    expect(normalizarPrefixo('   ')).toBe('')
    expect(normalizarPrefixo('...')).toBe('')
  })
})

describe('marcador', () => {
  it('lê o marcador do campo dedicado e também do conteúdo', () => {
    expect(extrairMarcador({ marcador: marcadorDaMensagem('ABC-1') })).toBe('ABC-1')
    expect(extrairMarcador({ conteudo: 'oi\n(simas-rec:ABC-1)' })).toBe('ABC-1')
  })

  it('sem marcador devolve null (não inventa casamento)', () => {
    expect(extrairMarcador({ conteudo: 'mensagem normal' })).toBeNull()
    expect(extrairMarcador({ marcador: 'simas-rec:' })).toBeNull()
    expect(extrairMarcador({})).toBeNull()
  })
})

describe('compativel', () => {
  it('casa mensagem igual dentro da tolerância', () => {
    expect(compativel(nossa(), cw({ timestampMs: T0 + 120_000 }))).toBe(true)
  })

  it('recusa fora da tolerância de 180s', () => {
    expect(compativel(nossa(), cw({ timestampMs: T0 + TOLERANCIA_MS + 1 }))).toBe(false)
  })

  it('recusa direção diferente (nossa saída × entrada do Chatwoot)', () => {
    expect(compativel(nossa({ deMim: true }), cw({ direcao: 'entrada' }))).toBe(false)
    expect(compativel(nossa({ deMim: true }), cw({ direcao: 'saida' }))).toBe(true)
  })

  it('recusa nota privada e atividade (não são mensagem de WhatsApp)', () => {
    expect(compativel(nossa(), cw({ privada: true }))).toBe(false)
    expect(compativel(nossa(), cw({ direcao: 'atividade' }))).toBe(false)
  })

  it('recusa texto diferente', () => {
    expect(compativel(nossa(), cw({ conteudo: 'outra coisa completamente' }))).toBe(false)
  })

  it('texto puro não casa com anexo (e vice-versa)', () => {
    expect(compativel(nossa(), cwPdf())).toBe(false)
    expect(compativel(nossaPdf(), cw())).toBe(false)
  })

  it('mídia sem legenda casa com anexo sem conteúdo', () => {
    expect(compativel(nossaPdf(), cwPdf())).toBe(true)
  })

  it('mídia tolera legenda perdida pela ponte (um lado sem texto)', () => {
    expect(compativel(nossaPdf({ texto: 'segue o contrato' }), cwPdf())).toBe(true)
    expect(compativel(nossaPdf(), cwPdf({ conteudo: 'contrato.pdf' }))).toBe(true)
  })

  it('recusa tipo de mídia evidentemente incompatível', () => {
    const audio = nossa({ tipo: 'audio', texto: null, temMedia: true })
    expect(compativel(audio, cwPdf({ anexos: [{ tipo: 'image', tamanho: null }] }))).toBe(false)
    expect(compativel(audio, cwPdf({ anexos: [{ tipo: 'audio', tamanho: null }] }))).toBe(true)
  })

  it('recusa timestamp inválido do Chatwoot (0 = relay não informou)', () => {
    expect(compativel(nossa(), cw({ timestampMs: 0 }))).toBe(false)
  })
})

describe('tipoMidiaCompativel / tamanhoAproximado', () => {
  it('tipo desconhecido no Chatwoot não invalida', () => {
    expect(tipoMidiaCompativel('imagem', null)).toBe(true)
    expect(tipoMidiaCompativel('imagem', '')).toBe(true)
  })

  it('documento aceita os rótulos que o Chatwoot costuma dar', () => {
    expect(tipoMidiaCompativel('documento', 'file')).toBe(true)
    expect(tipoMidiaCompativel('documento', 'image')).toBe(true)
  })

  it('tamanho ausente de um dos lados não decide nada', () => {
    expect(tamanhoAproximado(120_000, null)).toBe(true)
    expect(tamanhoAproximado(null, null)).toBe(true)
  })

  it('tolera reempacotamento (10% ou 4 KB) e recusa tamanho muito diferente', () => {
    expect(tamanhoAproximado(1_000_000, 1_050_000)).toBe(true)
    expect(tamanhoAproximado(1_000, 3_000)).toBe(true) // folga mínima de 4 KB
    expect(tamanhoAproximado(1_000_000, 200_000)).toBe(false)
  })
})

describe('casarMensagens — o caso real dos 2 PDFs em sequência SEM texto', () => {
  const pdfA = nossaPdf({ id: 'nA', mensagemId: 'A', timestampMs: T0 })
  const pdfB = nossaPdf({ id: 'nB', mensagemId: 'B', timestampMs: T0 + 8_000 })

  it('os dois chegaram: cada um casa com o seu (nenhum casa duas vezes)', () => {
    const pares = casarMensagens(
      [pdfA, pdfB],
      [cwPdf({ id: 10, timestampMs: T0 + 500 }), cwPdf({ id: 11, timestampMs: T0 + 8_400 })],
    )
    expect(pares).toHaveLength(2)
    expect(pares.find((p) => p.nossaId === 'nA')?.chatwootId).toBe(10)
    expect(pares.find((p) => p.nossaId === 'nB')?.chatwootId).toBe(11)
  })

  it('só UM chegou ao Chatwoot: só um é confirmado — o outro vira reposição', () => {
    const pares = casarMensagens([pdfA, pdfB], [cwPdf({ id: 10, timestampMs: T0 + 8_400 })])
    expect(pares).toHaveLength(1)
    // O mais próximo no tempo é o B (Δ 400ms contra 8,4s do A).
    expect(pares[0].nossaId).toBe('nB')
    expect(pares[0].porMarcador).toBe(false)
  })

  it('nenhum chegou: nada casa (os dois viram reposição)', () => {
    expect(casarMensagens([pdfA, pdfB], [])).toHaveLength(0)
  })

  it('mensagem do Chatwoot fora da tolerância não serve de par', () => {
    const pares = casarMensagens([pdfA], [cwPdf({ id: 10, timestampMs: T0 + 600_000 })])
    expect(pares).toHaveLength(0)
  })
})

describe('casarMensagens — marcador tem precedência', () => {
  it('casa pelo marcador mesmo com texto e tempo diferentes', () => {
    const minha = nossa({ id: 'n9', mensagemId: 'EVO9', timestampMs: T0 })
    const cwComMarcador = cw({
      id: 77,
      timestampMs: T0 + 3_600_000, // reposta uma hora depois
      conteudo: '[27/07 09:00] bom dia doutora (simas-rec:EVO9)',
    })
    const pares = casarMensagens([minha], [cwComMarcador])
    expect(pares).toEqual([{ nossaId: 'n9', chatwootId: 77, porMarcador: true }])
  })

  it('marcador de outra mensagem não rouba o par heurístico', () => {
    const minha = nossa({ id: 'n1', mensagemId: 'EVO1' })
    const outra = cw({ id: 5, marcador: marcadorDaMensagem('EVO-DESCONHECIDA') })
    const pares = casarMensagens([minha], [outra])
    // Casou pela heurística (mesma direção/texto/tempo), não pelo marcador.
    expect(pares).toEqual([{ nossaId: 'n1', chatwootId: 5, porMarcador: false }])
  })

  it('uma mensagem do Chatwoot não é consumida por duas nossas', () => {
    const a = nossa({ id: 'nA', mensagemId: 'A', timestampMs: T0 })
    const b = nossa({ id: 'nB', mensagemId: 'B', timestampMs: T0 + 1_000 })
    const pares = casarMensagens([a, b], [cw({ id: 42, timestampMs: T0 })])
    expect(pares).toHaveLength(1)
    expect(pares[0].nossaId).toBe('nA') // Δ 0 ganha de Δ 1s
  })
})

describe('normalizarMensagensChatwoot — parser defensivo', () => {
  it('lê conteúdo, anexos e marcador; descarta lixo', () => {
    const msgs = normalizarMensagensChatwoot({
      mensagens: [
        { id: 1, timestamp: 1753617600, direcao: 'entrada', conteudo: 'oi', anexos: [{ tipo: 'file', tamanho: 10 }] },
        { id: 'nao-numero' },
        null,
        'lixo',
        { id: 2, marcador: 'simas-rec:X' },
      ],
    })
    expect(msgs).toHaveLength(2)
    expect(msgs[0].timestampMs).toBe(1753617600 * 1000) // relay entrega em SEGUNDOS
    expect(msgs[0].anexos).toEqual([{ tipo: 'file', tamanho: 10 }])
    expect(msgs[1].marcador).toBe('simas-rec:X')
    expect(msgs[1].conteudo).toBe('')
  })

  it('payload sem a lista devolve vazio (nunca lança)', () => {
    expect(normalizarMensagensChatwoot(null)).toEqual([])
    expect(normalizarMensagensChatwoot({ mensagens: 'x' })).toEqual([])
  })
})

describe('mensagemNossaDaLinha', () => {
  it('mídia pendente (sem binário) ainda conta como mídia', () => {
    const m = mensagemNossaDaLinha({
      id: 'n1',
      mensagem_id: 'E1',
      de_mim: null,
      tipo: 'documento',
      texto: null,
      media_storage_path: null,
      media_pendente_motivo: 'download_falhou',
      media_tamanho: null,
      timestamp_msg: '2026-07-27T12:00:00.000Z',
    })
    expect(m.temMedia).toBe(true)
    expect(m.deMim).toBe(false)
    expect(m.timestampMs).toBe(T0)
  })
})

describe('coberturaDoIndice — até onde "não achei" prova "não existe"', () => {
  it('piso = atividade da conversa MENOS recente que o índice alcançou', () => {
    expect(
      coberturaDoIndice([
        { ultimaMensagemMs: T0 },
        { ultimaMensagemMs: T0 - 3_600_000 },
        { ultimaMensagemMs: T0 - 600_000 },
      ]),
    ).toBe(T0 - 3_600_000)
  })

  it('índice vazio (Chatwoot sem conversas) = cobertura total', () => {
    expect(coberturaDoIndice([])).toBe(0)
  })

  it('ignora conversa sem timestamp conhecido (relay não informou)', () => {
    expect(coberturaDoIndice([{ ultimaMensagemMs: 0 }, { ultimaMensagemMs: T0 }])).toBe(T0)
    expect(coberturaDoIndice([{ ultimaMensagemMs: 0 }])).toBe(0)
  })
})

describe('pisoDaLeitura — até onde a thread lida prova ausência', () => {
  it('leitura completa cobre tudo', () => {
    expect(pisoDaLeitura({ msgs: [cw({ timestampMs: T0 })], completa: true })).toBe(0)
    expect(pisoDaLeitura({ msgs: [], completa: true })).toBe(0)
  })

  it('leitura truncada só cobre até a mensagem mais antiga que veio', () => {
    const msgs = [cw({ id: 1, timestampMs: T0 }), cw({ id: 2, timestampMs: T0 - 7_200_000 })]
    expect(pisoDaLeitura({ msgs, completa: false })).toBe(T0 - 7_200_000)
  })

  it('truncada sem timestamp utilizável não trava a reposição', () => {
    expect(pisoDaLeitura({ msgs: [cw({ timestampMs: 0 })], completa: false })).toBe(0)
  })
})

describe('direcaoRelayDe', () => {
  it('de_mim é saída; recebida é entrada', () => {
    expect(direcaoRelayDe(true)).toBe('saida')
    expect(direcaoRelayDe(false)).toBe('entrada')
  })
})
