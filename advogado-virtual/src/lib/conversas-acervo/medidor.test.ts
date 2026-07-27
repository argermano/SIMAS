import { describe, it, expect } from 'vitest'
import {
  alcancouInicio,
  casaConversaChatwoot,
  contarNoDia,
  conversasParaMedir,
  deficits,
  desdeCandidatas,
  divergiu,
  ehGrupoJid,
  inboxDaInstancia,
  janelaMedida,
  msDoTimestampRelay,
  normalizarListaRelay,
  normalizarMensagensRelay,
  podeChamarRelay,
  proximoBefore,
  telefoneDoJid,
  type MensagemChatwootLeve,
} from './medidor'

// Lógica PURA do medidor de paridade (082 / plano Conversas Próprias, Etapa 0.3).
// Nada aqui toca banco ou relay: são as decisões que definem a régua —
// janela do dia, correspondência da conversa e contagem comparável.

const DIA_MS = 86_400_000

function msg(over: Partial<MensagemChatwootLeve> = {}): MensagemChatwootLeve {
  return { id: 1, timestampMs: 0, direcao: 'entrada', privada: false, ...over }
}

describe('janelaMedida — último dia civil COMPLETO de São Paulo', () => {
  it('às 8h de SP (11h UTC, horário do cron) mede o dia ANTERIOR inteiro', () => {
    const j = janelaMedida(new Date('2026-07-27T11:00:00Z')) // 08:00 em SP
    expect(j.dia).toBe('2026-07-26')
    expect(j.inicioISO).toBe('2026-07-26T03:00:00.000Z') // 00:00 de SP (UTC-3)
    expect(j.fimISO).toBe('2026-07-27T03:00:00.000Z')
    expect(j.fimMs - j.inicioMs).toBe(DIA_MS)
  })

  it('logo depois da meia-noite de SP ainda mede o dia fechado anterior', () => {
    // 00:30 de SP do dia 27 = 03:30Z do dia 27 → 24h antes cai no dia 26.
    expect(janelaMedida(new Date('2026-07-27T03:30:00Z')).dia).toBe('2026-07-26')
  })

  it('às 23h de SP mede o dia anterior (nunca o dia em curso)', () => {
    // 23:00 de SP do dia 27 = 02:00Z do dia 28.
    expect(janelaMedida(new Date('2026-07-28T02:00:00Z')).dia).toBe('2026-07-26')
  })
})

describe('desdeCandidatas — corte de atividade recente', () => {
  it('estende as 24h para trás até cobrir o início do dia medido', () => {
    const agora = new Date('2026-07-27T11:00:00Z') // 08:00 SP
    const j = janelaMedida(agora)
    // 24h atrás seria 2026-07-26T11:00Z — perderia a madrugada do dia medido.
    expect(desdeCandidatas(agora, j)).toBe(j.inicioISO)
  })

  it('nunca corta DEPOIS das 24h (a régua sempre cobre o pedido do plano)', () => {
    for (const iso of ['2026-07-27T03:30:00Z', '2026-07-27T11:00:00Z', '2026-07-28T02:00:00Z']) {
      const agora = new Date(iso)
      const corte = Date.parse(desdeCandidatas(agora, janelaMedida(agora)))
      expect(corte).toBeLessThanOrEqual(agora.getTime() - DIA_MS)
      expect(corte).toBeGreaterThan(agora.getTime() - 2 * DIA_MS)
    }
  })
})

describe('telefoneDoJid / ehGrupoJid', () => {
  it('extrai o número do jid individual', () => {
    expect(telefoneDoJid('5547991186787@s.whatsapp.net')).toBe('5547991186787')
    expect(telefoneDoJid('5547991186787@c.us')).toBe('5547991186787')
  })

  it('descarta o sufixo de dispositivo', () => {
    expect(telefoneDoJid('5547991186787:12@s.whatsapp.net')).toBe('5547991186787')
  })

  it('grupo não tem telefone', () => {
    expect(ehGrupoJid('120363000000000000@g.us')).toBe(true)
    expect(telefoneDoJid('120363000000000000@g.us')).toBeNull()
  })

  it('jid opaco (@lid) ou curto demais não vira telefone', () => {
    expect(telefoneDoJid('98765432109876@lid')).toBeNull()
    expect(telefoneDoJid('123@s.whatsapp.net')).toBeNull()
    expect(telefoneDoJid('')).toBeNull()
  })
})

describe('inboxDaInstancia', () => {
  it('mapeia as duas unidades e ignora o desconhecido', () => {
    expect(inboxDaInstancia('whatsapp-df')).toBe('DF')
    expect(inboxDaInstancia('whatsapp-sc')).toBe('SC')
    expect(inboxDaInstancia('whatsapp-novo')).toBeNull()
  })
})

describe('casaConversaChatwoot', () => {
  const alvo = { telefone: '5547991186787', inbox: 'SC' as const }

  it('casa por telefone tolerando máscara e DDI', () => {
    expect(casaConversaChatwoot({ telefone: '+55 47 99118-6787', inbox: 'SC' }, alvo)).toBe(true)
  })

  it('não casa telefone diferente', () => {
    expect(casaConversaChatwoot({ telefone: '5547999990000', inbox: 'SC' }, alvo)).toBe(false)
  })

  it('mesmo número na OUTRA inbox é outra conversa', () => {
    expect(casaConversaChatwoot({ telefone: '5547991186787', inbox: 'DF' }, alvo)).toBe(false)
  })

  it('inbox desconhecida de um dos lados não invalida o match', () => {
    expect(casaConversaChatwoot({ telefone: '5547991186787', inbox: null }, alvo)).toBe(true)
    expect(
      casaConversaChatwoot({ telefone: '5547991186787', inbox: 'DF' }, { telefone: '5547991186787', inbox: null }),
    ).toBe(true)
  })

  it('sem telefone no contato do Chatwoot nunca casa', () => {
    expect(casaConversaChatwoot({ telefone: null, inbox: 'SC' }, alvo)).toBe(false)
  })
})

describe('conversasParaMedir — poupa chamada ao relay', () => {
  const inicio = Date.parse('2026-07-26T03:00:00Z')

  it('descarta conversa cuja última mensagem é anterior ao dia medido', () => {
    const dentro = { ultimaMensagemMs: inicio + 3600_000 }
    const antes = { ultimaMensagemMs: inicio - 3600_000 }
    expect(conversasParaMedir([dentro, antes], inicio)).toEqual([dentro])
  })

  it('mantém conversa sem timestamp conhecido (por precaução)', () => {
    const semTs = { ultimaMensagemMs: 0 }
    expect(conversasParaMedir([semTs], inicio)).toEqual([semTs])
  })
})

describe('msDoTimestampRelay', () => {
  it('trata segundos (contrato do relay) e milissegundos', () => {
    expect(msDoTimestampRelay(1_753_500_000)).toBe(1_753_500_000_000)
    expect(msDoTimestampRelay(1_753_500_000_000)).toBe(1_753_500_000_000)
  })

  it('lixo vira 0 (nunca NaN)', () => {
    expect(msDoTimestampRelay(undefined)).toBe(0)
    expect(msDoTimestampRelay('oi')).toBe(0)
    expect(msDoTimestampRelay(-5)).toBe(0)
  })
})

describe('normalizarListaRelay / normalizarMensagensRelay — parser defensivo', () => {
  it('lê o shape do relay e ignora item malformado', () => {
    const lista = normalizarListaRelay({
      conversas: [
        { id: 7, inbox: 'SC', contato: { telefone: '+554799118' }, ultimaMensagem: { timestamp: 1_753_500_000 } },
        { id: 'x' },
        null,
        { id: 9 },
      ],
    })
    expect(lista).toEqual([
      { id: 7, telefone: '+554799118', inbox: 'SC', ultimaMensagemMs: 1_753_500_000_000 },
      { id: 9, telefone: null, inbox: null, ultimaMensagemMs: 0 },
    ])
  })

  it('corpo inesperado do relay vira lista vazia (não lança)', () => {
    expect(normalizarListaRelay(null)).toEqual([])
    expect(normalizarListaRelay({ code: 'RELAY_INDISPONIVEL' })).toEqual([])
    expect(normalizarMensagensRelay({ mensagens: 'nada' })).toEqual([])
  })

  it('lê mensagens com direção e privada', () => {
    expect(
      normalizarMensagensRelay({
        mensagens: [{ id: 3, timestamp: 1_753_500_000, direcao: 'saida', privada: true }],
      }),
    ).toEqual([{ id: 3, timestampMs: 1_753_500_000_000, direcao: 'saida', privada: true }])
  })
})

describe('contarNoDia — só o que é mensagem de WhatsApp, dentro da janela', () => {
  const janela = {
    inicioMs: Date.parse('2026-07-26T03:00:00Z'),
    fimMs: Date.parse('2026-07-27T03:00:00Z'),
  }

  it('conta entrada e saída dentro da janela', () => {
    const n = contarNoDia(
      [
        msg({ id: 1, timestampMs: janela.inicioMs, direcao: 'entrada' }),
        msg({ id: 2, timestampMs: janela.fimMs - 1, direcao: 'saida' }),
      ],
      janela,
    )
    expect(n).toBe(2)
  })

  it('exclui atividade e nota privada (nunca chegam ao nosso acervo)', () => {
    const n = contarNoDia(
      [
        msg({ id: 1, timestampMs: janela.inicioMs + 10, direcao: 'atividade' }),
        msg({ id: 2, timestampMs: janela.inicioMs + 20, privada: true }),
        msg({ id: 3, timestampMs: janela.inicioMs + 30 }),
      ],
      janela,
    )
    expect(n).toBe(1)
  })

  it('fim da janela é EXCLUSIVO e o início inclusivo', () => {
    expect(contarNoDia([msg({ timestampMs: janela.fimMs })], janela)).toBe(0)
    expect(contarNoDia([msg({ timestampMs: janela.inicioMs - 1 })], janela)).toBe(0)
    expect(contarNoDia([msg({ timestampMs: janela.inicioMs })], janela)).toBe(1)
  })

  it('mensagem sem timestamp (0) não entra', () => {
    expect(contarNoDia([msg({ timestampMs: 0 })], janela)).toBe(0)
  })
})

describe('paginação para trás', () => {
  const inicio = Date.parse('2026-07-26T03:00:00Z')

  it('proximoBefore devolve o MENOR id da página (a mensagem mais antiga)', () => {
    expect(proximoBefore([msg({ id: 30 }), msg({ id: 12 }), msg({ id: 44 })])).toBe(12)
    expect(proximoBefore([])).toBeNull()
  })

  it('alcancouInicio só quando a página traz mensagem anterior ao dia', () => {
    expect(alcancouInicio([msg({ timestampMs: inicio + 1 })], inicio)).toBe(false)
    expect(alcancouInicio([msg({ timestampMs: inicio - 1 })], inicio)).toBe(true)
    // timestamp 0 (lixo) não pode ser lido como "muito antigo".
    expect(alcancouInicio([msg({ timestampMs: 0 })], inicio)).toBe(false)
  })
})

describe('divergiu / deficits / podeChamarRelay', () => {
  it('divergência é qualquer diferença entre as contagens', () => {
    expect(divergiu(5, 5)).toBe(false)
    expect(divergiu(5, 3)).toBe(true) // Chatwoot perdeu
    expect(divergiu(3, 5)).toBe(true) // nós perdemos
  })

  it('separa as duas direções (a do GO/NO-GO é faltandoNoAcervo)', () => {
    // Chatwoot tem 5, nós temos 3 → aposentar o Chatwoot perderia 2.
    expect(deficits(3, 5)).toEqual({ faltandoNoAcervo: 2, faltandoNoChatwoot: 0 })
    // Nós temos 5, o Chatwoot 3 → é o buraco da ponte, não um risco nosso.
    expect(deficits(5, 3)).toEqual({ faltandoNoAcervo: 0, faltandoNoChatwoot: 2 })
    expect(deficits(4, 4)).toEqual({ faltandoNoAcervo: 0, faltandoNoChatwoot: 0 })
  })

  it('só chama o relay com folga para o timeout de 8s', () => {
    const agora = 1_000_000
    expect(podeChamarRelay(agora + 30_000, agora)).toBe(true)
    expect(podeChamarRelay(agora + 5_000, agora)).toBe(false)
  })
})
