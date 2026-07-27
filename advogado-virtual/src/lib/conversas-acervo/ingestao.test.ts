import { describe, it, expect } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { EventoConversa } from './contrato'
import { ErroIngestao, ingerirEventos } from './ingestao'

// Fake mínimo do client admin: o que interessa aqui é a CONTABILIDADE
// (aceitos × duplicados) e a disciplina de não atualizar conversa à toa —
// o resto é coberto pelos testes das funções puras de normalizar.ts.

const TENANT = '11111111-1111-1111-1111-111111111111'

interface LinhaConversa {
  id: string
  instancia: string
  jid: string
  tipo: string | null
  titulo: string | null
  ultima_mensagem_em: string | null
}

function fakeAdmin(cfg: {
  conversas: LinhaConversa[]
  /** Quantas linhas de mensagem o banco realmente inseriu (o resto é duplicata). */
  inseridas: number
  erroEm?: 'conversas_upsert' | 'mensagens_upsert'
}) {
  const registro = {
    updates: [] as Record<string, string>[],
    mensagensEnviadas: 0,
    conversasUpsert: 0,
  }

  const client = {
    from(tabela: string) {
      if (tabela === 'conversas_acervo') {
        return {
          upsert: (linhas: unknown[]) => {
            registro.conversasUpsert = (linhas as unknown[]).length
            return Promise.resolve({
              error: cfg.erroEm === 'conversas_upsert' ? { message: 'boom' } : null,
            })
          },
          select: () => {
            const chain = {
              eq: () => chain,
              in: () => chain,
              then: (fn: (r: unknown) => unknown) =>
                Promise.resolve({ data: cfg.conversas, error: null }).then(fn),
            }
            return chain
          },
          update: (patch: Record<string, string>) => {
            registro.updates.push(patch)
            const chain = {
              eq: () => chain,
              then: (fn: (r: unknown) => unknown) => Promise.resolve({ error: null }).then(fn),
            }
            return chain
          },
        }
      }
      // conversa_mensagens
      return {
        upsert: (linhas: unknown[]) => {
          registro.mensagensEnviadas = linhas.length
          return {
            select: () =>
              Promise.resolve({
                data:
                  cfg.erroEm === 'mensagens_upsert'
                    ? null
                    : Array.from({ length: cfg.inseridas }, (_, i) => ({ id: `id${i}` })),
                error: cfg.erroEm === 'mensagens_upsert' ? { message: 'boom' } : null,
              }),
          }
        },
      }
    },
  } as unknown as SupabaseClient

  return { client, registro }
}

function evento(over: Partial<EventoConversa> = {}): EventoConversa {
  return {
    instancia: 'whatsapp-sc',
    mensagemId: '3EB0ABC',
    conversaJid: '5547991186787@s.whatsapp.net',
    tipoConversa: 'individual',
    deMim: false,
    timestamp: 1_700_000_000_000,
    tipo: 'texto',
    ...over,
  }
}

const conversaExistente: LinhaConversa = {
  id: 'c1',
  instancia: 'whatsapp-sc',
  jid: '5547991186787@s.whatsapp.net',
  tipo: 'individual',
  titulo: null,
  ultima_mensagem_em: null,
}

describe('ingerirEventos', () => {
  it('conta aceitos e duplicados (intra-lote + já existentes no banco)', async () => {
    const { client, registro } = fakeAdmin({ conversas: [conversaExistente], inseridas: 1 })
    const resultado = await ingerirEventos(client, TENANT, [
      evento({ mensagemId: 'a' }),
      evento({ mensagemId: 'a' }), // repetida DENTRO do lote
      evento({ mensagemId: 'b' }), // já existe no banco (banco inseriu só 1)
    ])
    expect(registro.mensagensEnviadas).toBe(2) // o lote foi deduplicado antes do insert
    expect(resultado).toEqual({ aceitos: 1, duplicados: 2, conversaIds: ['c1'] })
  })

  it('lote inteiro repetido (retry do encaminhador) = 0 aceitos, nada se perde', async () => {
    const { client } = fakeAdmin({ conversas: [conversaExistente], inseridas: 0 })
    const resultado = await ingerirEventos(client, TENANT, [
      evento({ mensagemId: 'a' }),
      evento({ mensagemId: 'b' }),
    ])
    expect(resultado).toEqual({ aceitos: 0, duplicados: 2, conversaIds: ['c1'] })
  })

  it('conversa já com timestamp mais novo não recebe UPDATE', async () => {
    const { client, registro } = fakeAdmin({
      conversas: [{ ...conversaExistente, ultima_mensagem_em: '2030-01-01T00:00:00.000Z' }],
      inseridas: 1,
    })
    await ingerirEventos(client, TENANT, [evento({ mensagemId: 'a' })])
    expect(registro.updates).toHaveLength(0)
  })

  it('conversa nova/atrasada recebe UPDATE só do que mudou', async () => {
    const { client, registro } = fakeAdmin({ conversas: [conversaExistente], inseridas: 1 })
    await ingerirEventos(client, TENANT, [evento({ mensagemId: 'a' })])
    expect(registro.updates).toHaveLength(1)
    expect(registro.updates[0]).toHaveProperty('ultima_mensagem_em')
    expect(registro.updates[0]).not.toHaveProperty('titulo')
  })

  it('erro de banco vira exceção (a rota devolve 5xx e o VPS re-envia o lote)', async () => {
    const { client } = fakeAdmin({ conversas: [], inseridas: 0, erroEm: 'conversas_upsert' })
    await expect(ingerirEventos(client, TENANT, [evento()])).rejects.toBeInstanceOf(ErroIngestao)

    const segundo = fakeAdmin({
      conversas: [conversaExistente],
      inseridas: 0,
      erroEm: 'mensagens_upsert',
    })
    await expect(ingerirEventos(segundo.client, TENANT, [evento()])).rejects.toBeInstanceOf(
      ErroIngestao,
    )
  })

  it('conversa que sumiu entre o upsert e o select não vira insert órfão', async () => {
    const { client } = fakeAdmin({ conversas: [], inseridas: 0 })
    await expect(ingerirEventos(client, TENANT, [evento()])).rejects.toBeInstanceOf(ErroIngestao)
  })
})
