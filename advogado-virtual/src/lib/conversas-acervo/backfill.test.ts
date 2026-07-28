import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { relayFetch, relayFetchBinario } from '@/lib/conversas/relay'
import {
  avancoDoCursor,
  backfillLote,
  caminhoMediaBackfill,
  chaveCursor,
  criarRitmo,
  CURSORES_PADRAO,
  eventosDaMensagem,
  importavelParaAcervo,
  inboxParaRelay,
  instanciaDaInbox,
  jidDaConversa,
  linhaBackfill,
  MOTIVO_ANEXO_PENDENTE,
  mensagemIdDeChatwoot,
  nomeDoAnexo,
  normalizarConversasBackfill,
  normalizarMensagensBackfill,
  origemDoSender,
  podeBaixarAnexo,
  proximoCursor,
  tipoDaMensagem,
  tipoDoAnexo,
  type CursorBackfill,
  type MensagemBackfill,
} from './backfill'

vi.mock('@/lib/conversas/relay', () => ({
  relayFetch: vi.fn(),
  relayFetchBinario: vi.fn(),
}))

const TENANT = '11111111-1111-1111-1111-111111111111'
const CONVERSA = '22222222-2222-2222-2222-222222222222'

function cursor(p: Partial<CursorBackfill> & Pick<CursorBackfill, 'inbox' | 'status'>): CursorBackfill {
  return {
    pagina: 1,
    concluido: false,
    conversas_feitas: 0,
    mensagens_importadas: 0,
    anexos_importados: 0,
    conversas_pagina_ok: [],
    ...p,
  }
}

function mensagem(p: Partial<MensagemBackfill> & Pick<MensagemBackfill, 'id'>): MensagemBackfill {
  return {
    direcao: 'entrada',
    privada: false,
    conteudo: '',
    timestampMs: 1_750_000_000_000,
    senderTipo: 'cliente',
    sourceId: null,
    anexos: [],
    ...p,
  }
}

describe('cursor', () => {
  it('cobre os 4 status do Chatwoot nas 2 caixas, status-major', () => {
    expect(CURSORES_PADRAO.map((c) => chaveCursor(c.inbox, c.status))).toEqual([
      'df:open',
      'sc:open',
      'df:resolved',
      'sc:resolved',
      'df:pending',
      'sc:pending',
      'df:snoozed',
      'sc:snoozed',
    ])
  })

  it('pega o primeiro cursor não concluído na ordem padrão', () => {
    const escolhido = proximoCursor([
      cursor({ inbox: 'df', status: 'open', concluido: true }),
      cursor({ inbox: 'sc', status: 'open', pagina: 7 }),
      cursor({ inbox: 'df', status: 'resolved', pagina: 3 }),
    ])
    expect(escolhido).toMatchObject({ inbox: 'sc', status: 'open', pagina: 7 })
  })

  it('combinação sem linha no banco vira cursor novo na página 1', () => {
    const escolhido = proximoCursor([cursor({ inbox: 'df', status: 'open', concluido: true })])
    expect(escolhido).toMatchObject({ inbox: 'sc', status: 'open', pagina: 1, concluido: false })
  })

  it('tudo concluído devolve null (a rota vira no-op)', () => {
    const linhas = CURSORES_PADRAO.map((c) => cursor({ ...c, concluido: true }))
    expect(proximoCursor(linhas)).toBeNull()
  })

  it('listagem vazia conclui a combinação sem mexer na página', () => {
    expect(avancoDoCursor(4, { conversasNaPagina: 0, conversasFeitas: 0 })).toEqual({
      pagina: 4,
      concluido: true,
      conversasPaginaOk: [],
    })
  })

  it('página inteira importada avança a página e esquece as conversas feitas', () => {
    expect(
      avancoDoCursor(4, { conversasNaPagina: 25, conversasFeitas: 25, feitasIds: [1, 2] }),
    ).toEqual({ pagina: 5, concluido: false, conversasPaginaOk: [] })
  })

  it('página incompleta guarda quem já terminou (progresso durável na página)', () => {
    expect(
      avancoDoCursor(4, { conversasNaPagina: 25, conversasFeitas: 9, feitasIds: [7, 8, 9] }),
    ).toEqual({ pagina: 4, concluido: false, conversasPaginaOk: [7, 8, 9] })
  })
})

describe('ritmo (rate limit do lado de cá)', () => {
  it('espaçamento 0 nunca espera', async () => {
    const ritmo = criarRitmo(0)
    expect(await ritmo()).toBe(0)
    expect(await ritmo()).toBe(0)
  })

  it('segunda chamada no mesmo instante espera o espaçamento inteiro', async () => {
    const agora = 1_000 // relógio congelado: a espera é toda do espaçamento
    const ritmo = criarRitmo(5, () => agora)
    expect(await ritmo()).toBe(0)
    expect(await ritmo()).toBe(5)
  })

  it('chamada depois da folga não espera', async () => {
    let agora = 1_000
    const ritmo = criarRitmo(900, () => agora)
    await ritmo()
    agora += 5_000
    expect(await ritmo()).toBe(0)
  })
})

describe('mapeamento de identidade', () => {
  it('inbox → instância da Evolution e rótulo do relay', () => {
    expect(instanciaDaInbox('df')).toBe('whatsapp-df')
    expect(instanciaDaInbox('SC')).toBe('whatsapp-sc')
    expect(instanciaDaInbox('xx')).toBeNull()
    expect(inboxParaRelay('df')).toBe('DF')
    expect(inboxParaRelay('sc')).toBe('SC')
    expect(inboxParaRelay('')).toBeNull()
  })

  it('telefone do contato vira jid individual só com dígitos', () => {
    expect(jidDaConversa({ telefone: '+55 (61) 99999-8888', identifier: null })).toEqual({
      jid: '5561999998888@s.whatsapp.net',
      tipo: 'individual',
    })
  })

  it('identifier de grupo vence o telefone', () => {
    expect(jidDaConversa({ telefone: '+5561999998888', identifier: '1203630@g.us' })).toEqual({
      jid: '1203630@g.us',
      tipo: 'grupo',
    })
  })

  it('contato sem telefone utilizável não é importável', () => {
    expect(jidDaConversa({ telefone: '123', identifier: null })).toBeNull()
    expect(jidDaConversa({ telefone: null, identifier: null })).toBeNull()
    expect(jidDaConversa({ telefone: null, identifier: '@g.us' })).toBeNull()
  })
})

describe('id da mensagem', () => {
  it('source_id WAID vira o MESMO id do encaminhador (dedupe natural)', () => {
    expect(mensagemIdDeChatwoot({ id: 55, sourceId: 'WAID:3EB0ABC123' })).toBe('3EB0ABC123')
    expect(mensagemIdDeChatwoot({ id: 55, sourceId: 'waid:3EB0ABC123' })).toBe('3EB0ABC123')
  })

  it('sem source_id usa o id do Chatwoot com prefixo cw:', () => {
    expect(mensagemIdDeChatwoot({ id: 55, sourceId: null })).toBe('cw:55')
    expect(mensagemIdDeChatwoot({ id: 55, sourceId: '   ' })).toBe('cw:55')
    expect(mensagemIdDeChatwoot({ id: 55, sourceId: 'WAID:' })).toBe('cw:55')
    expect(mensagemIdDeChatwoot({ id: 55 })).toBe('cw:55')
  })
})

describe('tipos, origem e filtro de importação', () => {
  it('file_type do Chatwoot → tipo do acervo', () => {
    expect(tipoDoAnexo('image')).toBe('imagem')
    expect(tipoDoAnexo('video')).toBe('video')
    expect(tipoDoAnexo('audio')).toBe('audio')
    expect(tipoDoAnexo('file')).toBe('documento')
    expect(tipoDoAnexo('story_mention')).toBe('outro')
    expect(tipoDoAnexo(null)).toBe('outro')
  })

  it('mensagem sem anexo é texto; com anexo, o tipo do primeiro', () => {
    expect(tipoDaMensagem([])).toBe('texto')
    expect(tipoDaMensagem([{ tipo: 'audio' }, { tipo: 'image' }])).toBe('audio')
  })

  it('origem só existe quando saiu do nosso número e o sender é inequívoco', () => {
    expect(origemDoSender(false, 'agente')).toBeUndefined()
    expect(origemDoSender(true, 'agente')).toBe('atendente')
    expect(origemDoSender(true, 'bot')).toBe('sistema')
    expect(origemDoSender(true, 'sistema')).toBe('sistema')
    expect(origemDoSender(true, 'cliente')).toBeUndefined()
    expect(origemDoSender(true, null)).toBeUndefined()
  })

  it('atividade, nota privada e mensagem sem data ficam de fora', () => {
    expect(importavelParaAcervo(mensagem({ id: 1 }))).toBe(true)
    expect(importavelParaAcervo(mensagem({ id: 2, direcao: 'atividade' }))).toBe(false)
    expect(importavelParaAcervo(mensagem({ id: 3, privada: true }))).toBe(false)
    expect(importavelParaAcervo(mensagem({ id: 4, timestampMs: 0 }))).toBe(false)
  })
})

describe('eventos a partir da mensagem do Chatwoot', () => {
  const ctx = {
    instancia: 'whatsapp-df' as const,
    jid: '5561999998888@s.whatsapp.net',
    tipoConversa: 'individual' as const,
  }

  it('mensagem de texto de entrada vira um evento sem mídia', () => {
    const [evento, ...resto] = eventosDaMensagem(
      mensagem({ id: 10, conteudo: 'bom dia', sourceId: 'WAID:ABC' }),
      ctx,
    )
    expect(resto).toHaveLength(0)
    expect(evento).toMatchObject({
      instancia: 'whatsapp-df',
      mensagemId: 'ABC',
      conversaJid: ctx.jid,
      tipoConversa: 'individual',
      deMim: false,
      tipo: 'texto',
      texto: 'bom dia',
      timestamp: 1_750_000_000_000,
    })
    expect(evento.media).toBeUndefined()
    expect(evento.origemProvavel).toBeUndefined()
  })

  it('mensagem de saída do atendente marca deMim + origem', () => {
    const [evento] = eventosDaMensagem(
      mensagem({ id: 11, direcao: 'saida', senderTipo: 'agente', conteudo: 'ok' }),
      ctx,
    )
    expect(evento.deMim).toBe(true)
    expect(evento.origemProvavel).toBe('atendente')
  })

  it('anexo nasce pendente (mensagem entra primeiro, binário depois)', () => {
    const [evento] = eventosDaMensagem(
      mensagem({ id: 12, conteudo: 'segue', anexos: [{ tipo: 'file', url: 'https://x/y/p.pdf' }] }),
      ctx,
    )
    expect(evento.tipo).toBe('documento')
    expect(evento.media).toEqual({ pendente: true, motivo: MOTIVO_ANEXO_PENDENTE })
  })

  it('anexos extras viram linhas próprias com id sufixado e estável', () => {
    const eventos = eventosDaMensagem(
      mensagem({
        id: 13,
        conteudo: 'dois',
        sourceId: 'WAID:XYZ',
        anexos: [
          { tipo: 'image', url: 'https://x/a.png' },
          { tipo: 'file', url: 'https://x/b.pdf' },
        ],
      }),
      ctx,
    )
    expect(eventos.map((e) => e.mensagemId)).toEqual(['XYZ', 'XYZ#a2'])
    expect(eventos[0].texto).toBe('dois')
    expect(eventos[1].texto).toBeUndefined()
  })

  it('grupo leva o título e o tipo da conversa', () => {
    const [evento] = eventosDaMensagem(mensagem({ id: 14 }), {
      instancia: 'whatsapp-sc',
      jid: '1203630@g.us',
      tipoConversa: 'grupo',
      tituloGrupo: 'Família Silva',
    })
    expect(evento.tipoConversa).toBe('grupo')
    expect(evento.tituloGrupo).toBe('Família Silva')
  })
})

describe('anti-loop da linha importada', () => {
  const [evento] = eventosDaMensagem(mensagem({ id: 20, conteudo: 'oi', sourceId: 'WAID:K1' }), {
    instancia: 'whatsapp-df',
    jid: '5561999998888@s.whatsapp.net',
    tipoConversa: 'individual',
  })

  it('nasce confirmada, com proveniência e SEM postada_em', () => {
    const linha = linhaBackfill(evento, { tenantId: TENANT, conversaId: CONVERSA }, 987, '2026-07-27T12:00:00.000Z')
    expect(linha.chatwoot_confirmada_em).toBe('2026-07-27T12:00:00.000Z')
    expect(linha.origem_backfill).toBe(true)
    expect(linha.chatwoot_msg_id).toBe('987')
    expect('chatwoot_postada_em' in linha).toBe(false)
  })

  it('mantém a identidade da mensagem e a data histórica', () => {
    const linha = linhaBackfill(evento, { tenantId: TENANT, conversaId: CONVERSA }, 987, '2026-07-27T12:00:00.000Z')
    expect(linha.mensagem_id).toBe('K1')
    expect(linha.tenant_id).toBe(TENANT)
    expect(linha.conversa_id).toBe(CONVERSA)
    expect(linha.timestamp_msg).toBe(new Date(1_750_000_000_000).toISOString())
  })

  it('anexo pendente vira motivo, nunca path inventado', () => {
    const [comAnexo] = eventosDaMensagem(
      mensagem({ id: 21, anexos: [{ tipo: 'image', url: 'https://x/a.png' }] }),
      { instancia: 'whatsapp-df', jid: '5561999998888@s.whatsapp.net', tipoConversa: 'individual' },
    )
    const linha = linhaBackfill(comAnexo, { tenantId: TENANT, conversaId: CONVERSA }, 1, '2026-07-27T12:00:00.000Z')
    expect(linha.media_storage_path).toBeNull()
    expect(linha.media_pendente_motivo).toBe(MOTIVO_ANEXO_PENDENTE)
  })
})

describe('storage e nomes', () => {
  it('path fica dentro do prefixo do acervo do tenant e sem traversal', () => {
    const path = caminhoMediaBackfill({
      tenantId: TENANT,
      conversaId: CONVERSA,
      mensagemId: '../../fuga',
      filename: 'a b/c..pdf',
    })
    expect(path.startsWith(`${TENANT}/conversas-acervo/backfill/`)).toBe(true)
    expect(path.includes('..')).toBe(false)
  })

  it('nome do anexo vem da URL, com fallback estável', () => {
    expect(nomeDoAnexo('https://cw/rails/blobs/peticao%20final.pdf', 'cw:9', 0)).toBe('peticao final.pdf')
    expect(nomeDoAnexo(null, 'cw:9', 1)).toBe('cw:9_2')
    expect(nomeDoAnexo('nao-url', 'cw:9', 0)).toBe('cw:9_1')
  })
})

describe('parsers defensivos do relay', () => {
  it('listagem: ignora lixo e lê contato/identifier quando existirem', () => {
    const conversas = normalizarConversasBackfill({
      conversas: [
        { id: 1, contato: { nome: 'Ana', telefone: '+5561999998888' } },
        { id: 'x', contato: null },
        null,
        { id: 2, contato: { identifier: '123@g.us' } },
      ],
    })
    expect(conversas).toEqual([
      { id: 1, nome: 'Ana', telefone: '+5561999998888', identifier: null },
      { id: 2, nome: null, telefone: null, identifier: '123@g.us' },
    ])
    expect(normalizarConversasBackfill(null)).toEqual([])
    expect(normalizarConversasBackfill({ conversas: 'nao-array' })).toEqual([])
  })

  it('mensagens: timestamp em segundos vira ms e source_id é lido nos dois nomes', () => {
    const msgs = normalizarMensagensBackfill({
      mensagens: [
        {
          id: 7,
          direcao: 'saida',
          privada: false,
          conteudo: 'oi',
          timestamp: 1_750_000_000,
          sender: { tipo: 'bot' },
          source_id: 'WAID:Z9',
          anexos: [{ tipo: 'image', url: 'https://x/a.png' }, 'lixo'],
        },
        { id: 'x' },
      ],
    })
    expect(msgs).toHaveLength(1)
    expect(msgs[0]).toMatchObject({
      id: 7,
      direcao: 'saida',
      timestampMs: 1_750_000_000_000,
      senderTipo: 'bot',
      sourceId: 'WAID:Z9',
    })
    expect(msgs[0].anexos).toEqual([{ tipo: 'image', url: 'https://x/a.png' }])
  })

  it('mensagem sem timestamp utilizável não é importável', () => {
    const [msg] = normalizarMensagensBackfill({ mensagens: [{ id: 8, timestamp: null }] })
    expect(msg.timestampMs).toBe(0)
    expect(importavelParaAcervo(msg)).toBe(false)
  })
})

describe('orçamento do tick', () => {
  it('anexo só começa com folga para baixar (15s) e subir (até 30s)', () => {
    expect(podeBaixarAnexo(100_000, 40_000)).toBe(true)
    expect(podeBaixarAnexo(100_000, 60_000)).toBe(false)
    expect(podeBaixarAnexo(100_000, 90_000)).toBe(false)
  })
})

/* ── Orquestração (I/O falso): o carimbo anti-loop tem de CHEGAR ao INSERT ── */

interface RegistroFake {
  mensagensInseridas: Record<string, unknown>[]
  cursorUpdate: Record<string, unknown> | null
  conversasUpsert: number
}

function fakeAdmin(cursores: CursorBackfill[]): { client: SupabaseClient; registro: RegistroFake } {
  const registro: RegistroFake = { mensagensInseridas: [], cursorUpdate: null, conversasUpsert: 0 }

  const resolvel = (resultado: unknown) => {
    const c: Record<string, unknown> = {}
    for (const metodo of ['select', 'eq', 'in', 'is', 'order', 'limit']) c[metodo] = () => c
    c.maybeSingle = () => Promise.resolve(resultado)
    c.then = (fn: (r: unknown) => unknown) => Promise.resolve(resultado).then(fn)
    return c
  }

  const client = {
    from(tabela: string) {
      if (tabela === 'conversas_backfill_estado') {
        return {
          upsert: () => Promise.resolve({ error: null }),
          select: () => resolvel({ data: cursores.map((c) => ({ ...c })), error: null }),
          update: (patch: Record<string, unknown>) => {
            registro.cursorUpdate = patch
            return resolvel({ error: null })
          },
        }
      }
      if (tabela === 'conversas_acervo') {
        return {
          upsert: () => {
            registro.conversasUpsert++
            return Promise.resolve({ error: null })
          },
          select: () =>
            resolvel({
              data: { id: CONVERSA, tipo: 'individual', titulo: null, ultima_mensagem_em: null },
              error: null,
            }),
          update: () => resolvel({ error: null }),
        }
      }
      // conversa_mensagens
      return {
        upsert: (linhas: Record<string, unknown>[]) => {
          registro.mensagensInseridas.push(...linhas)
          return {
            select: () =>
              Promise.resolve({ data: linhas.map((_, i) => ({ id: `m${i}` })), error: null }),
          }
        },
        select: () => resolvel({ data: [], error: null }),
        update: () => resolvel({ error: null }),
      }
    },
  } as unknown as SupabaseClient

  return { client, registro }
}

describe('backfillLote (orquestração)', () => {
  beforeEach(() => {
    vi.mocked(relayFetch).mockReset()
    vi.mocked(relayFetchBinario).mockReset()
  })

  it('importa a página, carimba anti-loop em toda linha e avança o cursor', async () => {
    vi.mocked(relayFetch).mockImplementation(async (path: string) => {
      if (path === '/conversations') {
        return {
          status: 200,
          data: { conversas: [{ id: 501, contato: { nome: 'Ana', telefone: '+5561999998888' } }] },
        }
      }
      // 1ª página de mensagens; a 2ª (com `before`) vem vazia = fim do histórico.
      const chamadas = vi.mocked(relayFetch).mock.calls.filter((c) => c[0] !== '/conversations')
      if (chamadas.length === 1) {
        return {
          status: 200,
          data: {
            mensagens: [
              {
                id: 90,
                direcao: 'entrada',
                privada: false,
                conteudo: 'oi',
                timestamp: 1_750_000_000,
                sender: { tipo: 'cliente' },
              },
              {
                id: 91,
                direcao: 'atividade',
                privada: false,
                conteudo: 'resolvida',
                timestamp: 1_750_000_100,
              },
            ],
          },
        }
      }
      return { status: 200, data: { mensagens: [] } }
    })

    const { client, registro } = fakeAdmin([cursor({ inbox: 'df', status: 'open', pagina: 3 })])
    const r = await backfillLote(client, { tenantId: TENANT, deadline: Date.now() + 60_000, espacamentoRelayMs: 0 })

    expect(r.motivo).toBe('ok')
    expect(r.conversasNaPagina).toBe(1)
    expect(r.conversasFeitas).toBe(1)
    expect(r.mensagensImportadas).toBe(1) // a 'atividade' não entra
    expect(registro.mensagensInseridas).toHaveLength(1)
    const linha = registro.mensagensInseridas[0]
    expect(linha.origem_backfill).toBe(true)
    expect(typeof linha.chatwoot_confirmada_em).toBe('string')
    expect('chatwoot_postada_em' in linha).toBe(false)
    expect(linha.mensagem_id).toBe('cw:90')
    expect(registro.cursorUpdate).toMatchObject({ pagina: 4, concluido: false, conversas_feitas: 1 })
  })

  it('listagem vazia conclui a combinação e não toca o acervo', async () => {
    vi.mocked(relayFetch).mockResolvedValue({ status: 200, data: { conversas: [] } })
    // Todas as combinações prontas menos a que vai ser encerrada agora.
    const { client, registro } = fakeAdmin(
      CURSORES_PADRAO.map((c) =>
        c.inbox === 'df' && c.status === 'open'
          ? cursor({ ...c, pagina: 9 })
          : cursor({ ...c, concluido: true }),
      ),
    )
    const r = await backfillLote(client, { tenantId: TENANT, deadline: Date.now() + 60_000, espacamentoRelayMs: 0 })

    expect(registro.mensagensInseridas).toHaveLength(0)
    expect(registro.cursorUpdate).toMatchObject({ pagina: 9, concluido: true })
    expect(r.concluido).toBe(true)
    expect(r.motivo).toBe('concluido')
  })

  it('com tudo concluído não chama o relay (no-op barato)', async () => {
    const { client } = fakeAdmin(CURSORES_PADRAO.map((c) => cursor({ ...c, concluido: true })))
    const r = await backfillLote(client, { tenantId: TENANT, deadline: Date.now() + 60_000, espacamentoRelayMs: 0 })
    expect(vi.mocked(relayFetch)).not.toHaveBeenCalled()
    expect(r).toMatchObject({ concluido: true, motivo: 'concluido', cursor: null })
  })

  it('erro do relay na listagem não mexe no cursor', async () => {
    vi.mocked(relayFetch).mockResolvedValue({ status: 502, data: { code: 'RELAY_INDISPONIVEL' } })
    const { client, registro } = fakeAdmin([cursor({ inbox: 'df', status: 'open', pagina: 2 })])
    const r = await backfillLote(client, { tenantId: TENANT, deadline: Date.now() + 60_000, espacamentoRelayMs: 0 })
    expect(r.motivo).toBe('relay_erro')
    expect(registro.cursorUpdate).toBeNull()
  })

  it('deadline estourado sai limpo, sem chamar o relay', async () => {
    const { client, registro } = fakeAdmin([cursor({ inbox: 'df', status: 'open' })])
    const r = await backfillLote(client, { tenantId: TENANT, deadline: Date.now() - 1, espacamentoRelayMs: 0 })
    expect(r.motivo).toBe('sem_tempo')
    expect(vi.mocked(relayFetch)).not.toHaveBeenCalled()
    expect(registro.cursorUpdate).toBeNull()
  })

  it('conversa já concluída na página é pulada sem custo de relay', async () => {
    vi.mocked(relayFetch).mockImplementation(async (path: string) => {
      if (path === '/conversations') {
        return {
          status: 200,
          data: {
            conversas: [
              { id: 501, contato: { telefone: '+5561999998888' } },
              { id: 502, contato: { telefone: '+5561999997777' } },
            ],
          },
        }
      }
      return { status: 200, data: { mensagens: [] } }
    })

    const { client } = fakeAdmin([
      cursor({ inbox: 'df', status: 'open', pagina: 2, conversas_pagina_ok: [501] }),
    ])
    const r = await backfillLote(client, {
      tenantId: TENANT,
      deadline: Date.now() + 60_000,
      espacamentoRelayMs: 0,
    })

    expect(r.conversasJaFeitas).toBe(1)
    expect(r.conversasFeitas).toBe(1)
    // Só a conversa 502 foi lida: a 501 não custou uma única chamada.
    const lidas = vi.mocked(relayFetch).mock.calls.filter((c) => c[0] !== '/conversations')
    expect(lidas.every((c) => String(c[0]).includes('/502/'))).toBe(true)
  })

  it('conversa apagada no Chatwoot (404) não trava a página', async () => {
    vi.mocked(relayFetch).mockImplementation(async (path: string) => {
      if (path === '/conversations') {
        return { status: 200, data: { conversas: [{ id: 777, contato: { telefone: '+5561999998888' } }] } }
      }
      return { status: 404, data: { code: 'NOT_FOUND' } }
    })

    const { client, registro } = fakeAdmin([cursor({ inbox: 'df', status: 'open', pagina: 5 })])
    const r = await backfillLote(client, {
      tenantId: TENANT,
      deadline: Date.now() + 60_000,
      espacamentoRelayMs: 0,
    })

    expect(r.conversasFeitas).toBe(1)
    expect(registro.mensagensInseridas).toHaveLength(0)
    expect(registro.cursorUpdate).toMatchObject({ pagina: 6, concluido: false })
  })
})
