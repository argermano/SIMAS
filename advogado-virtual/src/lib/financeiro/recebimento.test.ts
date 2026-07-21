import { describe, it, expect, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { processarAnexoRecebido, type RecebimentoDeps } from './recebimento'
import type { DadosComprovante } from './comprovante'

// ─────────────────────────────────────────────────────────────────────────────
// Fake do SupabaseClient no MESMO padrão de sentinela.test.ts: fila de
// resultados POR TABELA, consumida na ordem das chamadas a .from(tabela). O
// builder é chainável e "thenable" (como o supabase-js), então `await` na cadeia
// resolve o resultado enfileirado — não importa qual terminal (.maybeSingle,
// .select, .limit) fecha a query. `chamadas` registra cada método+args para
// asserção de roteamento e do invariante "nunca dá baixa".
//
// STORAGE: db.storage.from(bucket).{upload,remove} são registrados em `storage`
// (uploads/removes) para provar quais arquivos subiram e que o arquivo
// referenciado NÃO é removido no claim perdido.
// ─────────────────────────────────────────────────────────────────────────────

type Res = { data?: unknown; error?: unknown }
type Chamada = { tabela: string; metodo: string; args: unknown[] }

interface StorageCtl {
  uploadResult?: Res // default { error: null }
  uploads: { path: string }[]
  removes: string[][]
}

function novoStorage(uploadResult?: Res): StorageCtl {
  return { uploadResult, uploads: [], removes: [] }
}

const METODOS = [
  'select', 'eq', 'in', 'is', 'not', 'order', 'range', 'limit', 'update', 'upsert', 'maybeSingle', 'single',
]

function fakeDb(
  filas: Record<string, Res[]>,
  opts?: { chamadas?: Chamada[]; storage?: StorageCtl },
): SupabaseClient {
  const restantes: Record<string, Res[]> = Object.fromEntries(
    Object.entries(filas).map(([k, v]) => [k, [...v]]),
  )
  const chamadas = opts?.chamadas
  const st = opts?.storage
  return {
    from(tabela: string) {
      const fila = restantes[tabela]
      // Default { data: null }: seguro tanto p/ .maybeSingle (!!null === false)
      // quanto p/ .select array (data ?? [] / !data). Under-queue vira "vazio",
      // não um [] truthy que enganaria os `!!data`.
      const resultado: Res = fila && fila.length ? (fila.shift() as Res) : { data: null }
      const b: Record<string, unknown> = {}
      for (const m of METODOS) {
        b[m] = (...args: unknown[]) => {
          chamadas?.push({ tabela, metodo: m, args })
          return b
        }
      }
      b.then = (resolve: (v: Res) => void) => resolve(resultado)
      return b
    },
    storage: {
      from(_bucket: string) {
        return {
          upload: (path: string, _buf: unknown, _o?: unknown) => {
            st?.uploads.push({ path })
            return Promise.resolve(st?.uploadResult ?? { error: null })
          },
          remove: (paths: string[]) => {
            st?.removes.push(paths)
            return Promise.resolve({ error: null })
          },
        }
      },
    },
  } as unknown as SupabaseClient
}

// Stubs de I/O (relay + IA + audit) injetados via deps. `dados=null` => a imagem
// não é comprovante (extração retorna ok:false); senão retorna os dados dados.
function stubs(
  dados: DadosComprovante | null,
  opts?: { status?: number; buffer?: Buffer | null; contentType?: string | null },
) {
  const fetchBinario = vi.fn(async () => ({
    status: opts?.status ?? 200,
    buffer: opts && 'buffer' in opts ? (opts.buffer ?? null) : Buffer.from('bytes'),
    contentType: opts?.contentType ?? 'image/jpeg',
  })) as unknown as RecebimentoDeps['fetchBinario']
  const extrair = vi.fn(async () =>
    dados ? ({ ok: true, dados } as const) : ({ ok: false, motivo: 'nao_comprovante' } as const),
  ) as unknown as RecebimentoDeps['extrair']
  const auditar = vi.fn(async () => {}) as unknown as RecebimentoDeps['auditar']
  return { fetchBinario, extrair, auditar }
}

// Telefone real: DDI 55 + DDD 41 + 9 + 8 dígitos. mesmoTelefone casa igualdade.
const PHONE = '5541999998888'
const URL_OK = 'https://relay.local/attachments?url=x'

function dadosBase(over?: Partial<DadosComprovante>): DadosComprovante {
  return { valorCentavos: 10000, dataISO: '2026-07-10', ...over }
}

// INVARIANTE DURA (recebimento.ts:9): a função NUNCA dá baixa. Nenhuma escrita
// em `parcelas` pode carregar os campos de baixa (pago_em/pago_valor_centavos/
// meio/comprovante_url) nem status 'paga'. O staging só toca comprovante_recebido_*.
const CAMPOS_DE_BAIXA = ['pago_em', 'pago_valor_centavos', 'meio', 'comprovante_url']
function assertNuncaBaixa(chamadas: Chamada[]) {
  for (const c of chamadas) {
    if (c.tabela !== 'parcelas') continue
    if (c.metodo !== 'update' && c.metodo !== 'upsert') continue
    const payload = (c.args[0] ?? {}) as Record<string, unknown>
    for (const k of CAMPOS_DE_BAIXA) expect(payload).not.toHaveProperty(k)
    if ('status' in payload) expect(payload.status).not.toBe('paga')
  }
}

function fez(chamadas: Chamada[], tabela: string, metodo: string): boolean {
  return chamadas.some((c) => c.tabela === tabela && c.metodo === metodo)
}

describe('processarAnexoRecebido — entradas inválidas nunca tocam o banco', () => {
  it('telefone sem dígitos → retorna antes de qualquer query/IA', async () => {
    const chamadas: Chamada[] = []
    const storage = novoStorage()
    const s = stubs(dadosBase())
    await processarAnexoRecebido(
      { telefone: 'abc', anexoUrl: URL_OK, mensagemId: 'm1', conversaId: 'c1' },
      { db: fakeDb({}, { chamadas, storage }), ...s },
    )
    expect(chamadas).toEqual([])
    expect(s.fetchBinario).not.toHaveBeenCalled()
    expect(s.extrair).not.toHaveBeenCalled()
    expect(storage.uploads).toEqual([])
  })

  it('URL de anexo inválida (não http/https) → retorna antes do relay', async () => {
    const chamadas: Chamada[] = []
    const s = stubs(dadosBase())
    await processarAnexoRecebido(
      { telefone: PHONE, anexoUrl: 'ftp://malicioso/x', mensagemId: 'm1', conversaId: 'c1' },
      { db: fakeDb({}, { chamadas }), ...s },
    )
    expect(chamadas).toEqual([])
    expect(s.fetchBinario).not.toHaveBeenCalled()
  })
})

describe('processarAnexoRecebido — roteamento por tenant (guarda LGPD)', () => {
  it('telefone em MAIS DE UM tenant → descarta sem inbox nem staging', async () => {
    const chamadas: Chamada[] = []
    const storage = novoStorage()
    const s = stubs(dadosBase())
    const db = fakeDb(
      {
        clientes: [
          {
            data: [
              { id: 'c1', telefone: PHONE, tenant_id: 'tA' },
              { id: 'c2', telefone: PHONE, tenant_id: 'tB' },
            ],
          },
        ],
      },
      { chamadas, storage },
    )
    await processarAnexoRecebido(
      { telefone: PHONE, anexoUrl: URL_OK, mensagemId: 'm1', conversaId: 'c1' },
      { db, ...s },
    )
    // Nem baixa bytes/roda IA, nem inboxa, nem faz staging: para na guarda.
    expect(s.fetchBinario).not.toHaveBeenCalled()
    expect(s.extrair).not.toHaveBeenCalled()
    expect(storage.uploads).toEqual([])
    expect(fez(chamadas, 'comprovantes_recebidos', 'upsert')).toBe(false)
    expect(fez(chamadas, 'parcelas', 'update')).toBe(false)
    assertNuncaBaixa(chamadas)
  })

  it('telefone sem cliente + único tenant com Pix → cria INBOX sem cliente', async () => {
    const chamadas: Chamada[] = []
    const storage = novoStorage()
    const s = stubs(dadosBase()) // sem recebedorNome/chave → recebedor 'desconhecido' → mantém
    const db = fakeDb(
      {
        clientes: [{ data: [] }], // nenhum cliente casa
        tenants: [
          { data: [{ id: 't1' }] }, // tenantUnicoComPix: exatamente 1
          { data: { nome: 'Escritório', config: {} } }, // recebedorExterno
        ],
        comprovantes_recebidos: [
          { data: null }, // inboxJaRegistrado: não
          { data: [{ id: 'inbox1' }] }, // upsert inseriu
        ],
      },
      { chamadas, storage },
    )
    await processarAnexoRecebido(
      { telefone: PHONE, anexoUrl: URL_OK, mensagemId: 'm1', conversaId: 'c1' },
      { db, ...s },
    )
    expect(s.extrair).toHaveBeenCalledTimes(1)
    expect(storage.uploads).toHaveLength(1)
    expect(storage.uploads[0].path).toContain('/inbox/')
    // Auditou a criação do inbox (só ids, ação certa) e clienteId nulo.
    expect(s.auditar).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'financeiro.comprovante_inbox_criado', tenantId: 't1' }),
    )
    // Nunca stageia parcela nesse caminho.
    expect(fez(chamadas, 'parcelas', 'update')).toBe(false)
    assertNuncaBaixa(chamadas)
  })

  it('telefone sem cliente e SEM tenant único com Pix → descarta (não inboxa)', async () => {
    const chamadas: Chamada[] = []
    const storage = novoStorage()
    const s = stubs(dadosBase())
    const db = fakeDb(
      {
        clientes: [{ data: [] }],
        tenants: [{ data: [{ id: 't1' }, { id: 't2' }] }], // ambíguo (>1) → null
      },
      { chamadas, storage },
    )
    await processarAnexoRecebido(
      { telefone: PHONE, anexoUrl: URL_OK, mensagemId: 'm1', conversaId: 'c1' },
      { db, ...s },
    )
    expect(s.fetchBinario).not.toHaveBeenCalled()
    expect(storage.uploads).toEqual([])
    expect(fez(chamadas, 'comprovantes_recebidos', 'upsert')).toBe(false)
  })
})

describe('processarAnexoRecebido — dedup do webhook (reentrega/reenvio)', () => {
  it('dedup por mensagemId (parcela já carrega este mensagemId) → não roda IA', async () => {
    const chamadas: Chamada[] = []
    const storage = novoStorage()
    const s = stubs(dadosBase())
    const db = fakeDb(
      {
        clientes: [{ data: [{ id: 'c1', telefone: PHONE, tenant_id: 't1' }] }],
        parcelas: [
          { data: [{ id: 'p1', valor_centavos: 10000, vencimento: '2026-07-10' }] }, // abertas
          { data: { id: 'p1' } }, // jaProcessado: casa mensagemId
        ],
      },
      { chamadas, storage },
    )
    await processarAnexoRecebido(
      { telefone: PHONE, anexoUrl: URL_OK, mensagemId: 'm1', conversaId: 'c1' },
      { db, ...s },
    )
    expect(s.fetchBinario).not.toHaveBeenCalled()
    expect(s.extrair).not.toHaveBeenCalled()
    expect(storage.uploads).toEqual([])
    expect(fez(chamadas, 'parcelas', 'update')).toBe(false)
    assertNuncaBaixa(chamadas)
  })

  it('dedup por endToEndId (reenvio em nova mensagem) → ignora antes do staging', async () => {
    const chamadas: Chamada[] = []
    const storage = novoStorage()
    const s = stubs(dadosBase({ endToEndId: 'E2E-123' }))
    const db = fakeDb(
      {
        clientes: [{ data: [{ id: 'c1', telefone: PHONE, tenant_id: 't1' }] }],
        parcelas: [
          { data: [{ id: 'p1', valor_centavos: 10000, vencimento: '2026-07-10' }] }, // abertas
          { data: null }, // jaProcessado: não
          { data: null }, // duplicadoPorEndToEnd (lado parcelas)
        ],
        comprovantes_recebidos: [
          { data: null }, // inboxJaRegistrado: não
          { data: { id: 'inbox-existente' } }, // duplicadoPorEndToEnd (lado inbox): ACHOU
        ],
        tenants: [{ data: { nome: 'X', config: {} } }], // recebedorExterno → desconhecido
      },
      { chamadas, storage },
    )
    await processarAnexoRecebido(
      { telefone: PHONE, anexoUrl: URL_OK, mensagemId: 'm1', conversaId: 'c1' },
      { db, ...s },
    )
    expect(s.extrair).toHaveBeenCalledTimes(1) // precisa extrair p/ nascer o e2e
    // Nada é gravado: nem inbox, nem staging.
    expect(storage.uploads).toEqual([])
    expect(fez(chamadas, 'comprovantes_recebidos', 'upsert')).toBe(false)
    expect(fez(chamadas, 'parcelas', 'update')).toBe(false)
    assertNuncaBaixa(chamadas)
  })
})

describe('processarAnexoRecebido — filtro por recebedor', () => {
  it("recebedor CLARAMENTE de terceiro ('nao') → não stageia nem inboxa", async () => {
    const chamadas: Chamada[] = []
    const storage = novoStorage()
    const s = stubs(dadosBase({ recebedorNome: 'FULANO SILVA TERCEIRO' }))
    const db = fakeDb(
      {
        clientes: [{ data: [{ id: 'c1', telefone: PHONE, tenant_id: 't1' }] }],
        parcelas: [
          { data: [{ id: 'p1', valor_centavos: 10000, vencimento: '2026-07-10' }] }, // abertas
          { data: null }, // jaProcessado
        ],
        comprovantes_recebidos: [{ data: null }], // inboxJaRegistrado
        tenants: [
          // Recebedor extraído não intersecta o escritório → decisão 'nao'.
          { data: { nome: 'ESCRITORIO MARTA ADVOCACIA', config: { financeiro: { pix_nome: 'MARTA GERMANO' } } } },
        ],
      },
      { chamadas, storage },
    )
    await processarAnexoRecebido(
      { telefone: PHONE, anexoUrl: URL_OK, mensagemId: 'm1', conversaId: 'c1' },
      { db, ...s },
    )
    expect(s.extrair).toHaveBeenCalledTimes(1)
    expect(storage.uploads).toEqual([]) // terceiro barrado ANTES de subir arquivo
    expect(fez(chamadas, 'comprovantes_recebidos', 'upsert')).toBe(false)
    expect(fez(chamadas, 'parcelas', 'update')).toBe(false)
    assertNuncaBaixa(chamadas)
  })
})

describe('processarAnexoRecebido — anexo comum vs comprovante', () => {
  it('foto qualquer (extração ok:false) → silêncio, sem inbox nem staging', async () => {
    const chamadas: Chamada[] = []
    const storage = novoStorage()
    const s = stubs(null) // extração diz: não é comprovante
    const db = fakeDb(
      {
        clientes: [{ data: [{ id: 'c1', telefone: PHONE, tenant_id: 't1' }] }],
        parcelas: [
          { data: [{ id: 'p1', valor_centavos: 10000, vencimento: '2026-07-10' }] },
          { data: null }, // jaProcessado
        ],
        comprovantes_recebidos: [{ data: null }], // inboxJaRegistrado
      },
      { chamadas, storage },
    )
    await processarAnexoRecebido(
      { telefone: PHONE, anexoUrl: URL_OK, mensagemId: 'm1', conversaId: 'c1' },
      { db, ...s },
    )
    expect(s.fetchBinario).toHaveBeenCalledTimes(1)
    expect(s.extrair).toHaveBeenCalledTimes(1)
    expect(storage.uploads).toEqual([])
    expect(fez(chamadas, 'comprovantes_recebidos', 'upsert')).toBe(false)
    expect(fez(chamadas, 'parcelas', 'update')).toBe(false)
  })

  it('comprovante sem parcela que case (sugestão null) → vai para o INBOX', async () => {
    const chamadas: Chamada[] = []
    const storage = novoStorage()
    const s = stubs(dadosBase({ valorCentavos: 999 })) // nenhuma aberta casa 9,99
    const db = fakeDb(
      {
        clientes: [{ data: [{ id: 'c1', telefone: PHONE, tenant_id: 't1' }] }],
        parcelas: [
          { data: [{ id: 'p1', valor_centavos: 50000, vencimento: '2026-07-10' }] }, // abertas (500,00)
          { data: null }, // jaProcessado
        ],
        comprovantes_recebidos: [
          { data: null }, // inboxJaRegistrado
          { data: [{ id: 'inbox2' }] }, // upsert do inbox
        ],
        tenants: [{ data: { nome: 'X', config: {} } }], // recebedorExterno → desconhecido
      },
      { chamadas, storage },
    )
    await processarAnexoRecebido(
      { telefone: PHONE, anexoUrl: URL_OK, mensagemId: 'm1', conversaId: 'c1' },
      { db, ...s },
    )
    expect(storage.uploads).toHaveLength(1)
    expect(storage.uploads[0].path).toContain('/inbox/')
    expect(s.auditar).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'financeiro.comprovante_inbox_criado' }),
    )
    // Inbox, nunca claim de parcela.
    expect(fez(chamadas, 'parcelas', 'update')).toBe(false)
    assertNuncaBaixa(chamadas)
  })
})

describe('processarAnexoRecebido — staging por claim atômico (INVARIANTE: nunca dá baixa)', () => {
  it('parcela casa e claim vence → grava comprovante_recebido_* (staging), NÃO baixa', async () => {
    const chamadas: Chamada[] = []
    const storage = novoStorage()
    const s = stubs(dadosBase()) // valor 100,00 casa a parcela p1
    const db = fakeDb(
      {
        clientes: [{ data: [{ id: 'c1', telefone: PHONE, tenant_id: 't1' }] }],
        parcelas: [
          { data: [{ id: 'p1', valor_centavos: 10000, vencimento: '2026-07-10' }] }, // abertas
          { data: null }, // jaProcessado
          { data: [{ id: 'p1' }] }, // claim: venceu (1 linha)
        ],
        comprovantes_recebidos: [{ data: null }], // inboxJaRegistrado
        tenants: [{ data: { nome: 'X', config: {} } }], // recebedor desconhecido → mantém
      },
      { chamadas, storage },
    )
    await processarAnexoRecebido(
      { telefone: PHONE, anexoUrl: URL_OK, mensagemId: 'm1', conversaId: 'c1' },
      { db, ...s },
    )
    // Subiu o arquivo no staging (pendentes/) e reclamou a parcela.
    expect(storage.uploads).toHaveLength(1)
    expect(storage.uploads[0].path).toContain('/pendentes/')
    const claim = chamadas.find((c) => c.tabela === 'parcelas' && c.metodo === 'update')
    expect(claim).toBeTruthy()
    const payload = claim!.args[0] as Record<string, unknown>
    // Staging toca SÓ os campos de "recebido", nunca os de baixa.
    expect(Object.keys(payload).sort()).toEqual(
      ['comprovante_recebido_dados', 'comprovante_recebido_em', 'comprovante_recebido_url'],
    )
    // Auditou como "recebido" (staging), NÃO como pagamento/baixa.
    expect(s.auditar).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'financeiro.comprovante_recebido', resourceType: 'parcela', resourceId: 'p1' }),
    )
    // Não criou inbox (foi staged na parcela).
    expect(fez(chamadas, 'comprovantes_recebidos', 'upsert')).toBe(false)
    assertNuncaBaixa(chamadas)
  })

  it('claim PERDIDO com arquivo referenciado → inboxa e NÃO remove o arquivo staged', async () => {
    const mensagemId = 'm1'
    // Path determinístico do staging (contentType image/jpeg → jpg).
    const stagingPath = 'financeiro/t1/pendentes/p1-' + mensagemId + '.jpg'
    const chamadas: Chamada[] = []
    const storage = novoStorage()
    const s = stubs(dadosBase())
    const db = fakeDb(
      {
        clientes: [{ data: [{ id: 'c1', telefone: PHONE, tenant_id: 't1' }] }],
        parcelas: [
          { data: [{ id: 'p1', valor_centavos: 10000, vencimento: '2026-07-10' }] }, // abertas
          { data: null }, // jaProcessado
          { data: [] }, // claim: PERDIDO (0 linhas)
          // cur: outra mensagem venceu, MAS o arquivo staged é o mesmo path.
          {
            data: {
              comprovante_recebido_url: stagingPath,
              comprovante_url: null,
              comprovante_recebido_dados: { mensagemId: 'OUTRA-MSG' },
            },
          },
        ],
        comprovantes_recebidos: [
          { data: null }, // inboxJaRegistrado
          { data: [{ id: 'inbox3' }] }, // upsert do inbox (claim perdido → inbox)
        ],
        tenants: [{ data: { nome: 'X', config: {} } }],
      },
      { chamadas, storage },
    )
    await processarAnexoRecebido(
      { telefone: PHONE, anexoUrl: URL_OK, mensagemId, conversaId: 'c1' },
      { db, ...s },
    )
    // Dois uploads: o staging (pendentes/) + o inbox.
    expect(storage.uploads.map((u) => u.path).some((p) => p.includes('/pendentes/'))).toBe(true)
    expect(storage.uploads.map((u) => u.path).some((p) => p.includes('/inbox/'))).toBe(true)
    // O arquivo staged é referenciado pela parcela → NUNCA removido.
    expect(storage.removes).toEqual([])
    // Foi para o inbox (mensagem diferente venceu a corrida).
    expect(s.auditar).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'financeiro.comprovante_inbox_criado' }),
    )
    assertNuncaBaixa(chamadas)
  })

  it('claim PERDIDO com arquivo NÃO referenciado → remove o arquivo órfão do staging', async () => {
    const mensagemId = 'm1'
    const chamadas: Chamada[] = []
    const storage = novoStorage()
    const s = stubs(dadosBase())
    const db = fakeDb(
      {
        clientes: [{ data: [{ id: 'c1', telefone: PHONE, tenant_id: 't1' }] }],
        parcelas: [
          { data: [{ id: 'p1', valor_centavos: 10000, vencimento: '2026-07-10' }] },
          { data: null }, // jaProcessado
          { data: [] }, // claim perdido
          // cur: aponta para OUTRO arquivo (não o nosso path) e outra mensagem.
          {
            data: {
              comprovante_recebido_url: 'financeiro/t1/pendentes/p1-VENCEDORA.jpg',
              comprovante_url: null,
              comprovante_recebido_dados: { mensagemId: 'VENCEDORA' },
            },
          },
        ],
        comprovantes_recebidos: [
          { data: null }, // inboxJaRegistrado
          { data: [{ id: 'inbox4' }] }, // upsert do inbox
        ],
        tenants: [{ data: { nome: 'X', config: {} } }],
      },
      { chamadas, storage },
    )
    await processarAnexoRecebido(
      { telefone: PHONE, anexoUrl: URL_OK, mensagemId, conversaId: 'c1' },
      { db, ...s },
    )
    // Nosso arquivo staged não é referenciado por ninguém → é removido.
    expect(storage.removes).toHaveLength(1)
    expect(storage.removes[0][0]).toContain('/pendentes/')
    assertNuncaBaixa(chamadas)
  })
})

describe('processarAnexoRecebido — nunca lança (webhook não pode 500)', () => {
  it('client que explode vira no-op silencioso', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const s = stubs(dadosBase())
    const db = {
      from() {
        throw new Error('boom')
      },
    } as unknown as SupabaseClient
    await expect(
      processarAnexoRecebido(
        { telefone: PHONE, anexoUrl: URL_OK, mensagemId: 'm1', conversaId: 'c1' },
        { db, ...s },
      ),
    ).resolves.toBeUndefined()
    vi.restoreAllMocks()
  })
})
