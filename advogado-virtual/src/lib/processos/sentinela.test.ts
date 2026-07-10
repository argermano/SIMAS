import { describe, it, expect } from 'vitest'
import {
  ehMovimentoDePublicacao,
  janelaCasamento,
  deveAlertar,
  casarPublicacoes,
  rodarSentinela,
  sanitizarDiasEspera,
} from './sentinela'

const CNJ = '10688310520204013400' // caso real: 1068831-05.2020.4.01.3400

describe('ehMovimentoDePublicacao — curadoria de naturezas que implicam diário', () => {
  it.each([
    'Publicação',
    'Publicado o acórdão',
    'Publicado(a) o(a) despacho em 09/07/2026',
    'Disponibilização no Diário da Justiça Eletrônico',
    'Disponibilizado no Diário da Justiça Eletrônico',
    'Disponibilizado no DJE',
    'Remetido ao DJE',
    'Republicação',
    'Republicado o edital',
  ])('positivo: "%s"', (nome) => {
    expect(ehMovimentoDePublicacao(nome)).toBe(true)
  })

  it.each([
    'Expedição de documento',
    'Intimação',
    'Conclusão para despacho',
    'Juntada de Petição',
    'Decurso de Prazo',
    'Expedição de intimação via sistema',
  ])('negativo (intimação via portal/expediente não é diário): "%s"', (nome) => {
    expect(ehMovimentoDePublicacao(nome)).toBe(false)
  })

  it('string vazia → false', () => {
    expect(ehMovimentoDePublicacao('')).toBe(false)
  })
})

describe('sanitizarDiasEspera — env inválida nunca desliga a sentinela', () => {
  it('lixo ("2 dias") → default 2 (NaN mataria a sentinela em silêncio)', () => {
    expect(sanitizarDiasEspera('2 dias')).toBe(2)
  })
  it('ausente/vazia → default 2', () => {
    expect(sanitizarDiasEspera(undefined)).toBe(2)
    expect(sanitizarDiasEspera('')).toBe(2)
    expect(sanitizarDiasEspera('  ')).toBe(2)
  })
  it('negativa → default 2 (alertaria antes do DJEN indexar)', () => {
    expect(sanitizarDiasEspera('-1')).toBe(2)
  })
  it('valores válidos passam ("0" é permitido explicitamente)', () => {
    expect(sanitizarDiasEspera('0')).toBe(0)
    expect(sanitizarDiasEspera('5')).toBe(5)
  })
})

describe('janelaCasamento — ±3 dias em YYYY-MM-DD', () => {
  it('data simples', () => {
    expect(janelaCasamento('2026-07-09')).toEqual({ de: '2026-07-06', ate: '2026-07-12' })
  })
  it('aceita timestamptz completo (usa só o dia)', () => {
    expect(janelaCasamento('2026-07-09T14:30:00-03:00')).toEqual({ de: '2026-07-06', ate: '2026-07-12' })
  })
  it('não escorrega em borda de mês', () => {
    expect(janelaCasamento('2026-08-01')).toEqual({ de: '2026-07-29', ate: '2026-08-04' })
  })
})

describe('deveAlertar — carência e teto retroativo', () => {
  const agora = '2026-07-10T12:00:00Z'
  it('movimento de ontem (1d) com carência 2d → ainda NÃO alerta (DJEN indexa D/D+1)', () => {
    expect(deveAlertar('2026-07-09T12:00:00Z', agora, 2)).toBe(false)
  })
  it('exatamente na carência (2d) → alerta', () => {
    expect(deveAlertar('2026-07-08T12:00:00Z', agora, 2)).toBe(true)
  })
  it('dentro da janela (5d) → alerta', () => {
    expect(deveAlertar('2026-07-05T12:00:00Z', agora, 2)).toBe(true)
  })
  it('exatamente no teto (45d) → alerta', () => {
    expect(deveAlertar('2026-05-26T12:00:00Z', agora, 2)).toBe(true)
  })
  it('mais velho que o teto (46d) → NÃO alerta', () => {
    expect(deveAlertar('2026-05-25T12:00:00Z', agora, 2)).toBe(false)
  })
  it('data inválida → false (nunca alerta por lixo)', () => {
    expect(deveAlertar('não-é-data', agora, 2)).toBe(false)
  })
})

describe('casarPublicacoes — mesmo número por dígitos + janela de ±3d', () => {
  const mov = '2026-07-09T00:00:00-03:00'
  it('casa por dígitos mesmo quando a publicação vem com MÁSCARA', () => {
    const pubs = [{ numero: '1068831-05.2020.4.01.3400', data: '2026-07-10' }]
    expect(casarPublicacoes(CNJ, mov, pubs)).toBe(true)
  })
  it('casa nos extremos da janela (−3d e +3d)', () => {
    expect(casarPublicacoes(CNJ, mov, [{ numero: CNJ, data: '2026-07-06' }])).toBe(true)
    expect(casarPublicacoes(CNJ, mov, [{ numero: CNJ, data: '2026-07-12' }])).toBe(true)
  })
  it('fora da janela → não casa', () => {
    expect(casarPublicacoes(CNJ, mov, [{ numero: CNJ, data: '2026-07-13' }])).toBe(false)
    expect(casarPublicacoes(CNJ, mov, [{ numero: CNJ, data: '2026-07-05' }])).toBe(false)
  })
  it('número diferente → não casa', () => {
    expect(casarPublicacoes(CNJ, mov, [{ numero: '00000000000000000000', data: '2026-07-09' }])).toBe(false)
  })
  it('sem publicações → não casa', () => {
    expect(casarPublicacoes(CNJ, mov, [])).toBe(false)
  })
  it('número alvo vazio → não casa (nunca casa tudo)', () => {
    expect(casarPublicacoes('', mov, [{ numero: '', data: '2026-07-09' }])).toBe(false)
  })
})

/* ── rodarSentinela (I/O mockado; contrato de contagens e resiliência) ──── */

type Resultado = { data: unknown; error?: unknown }
type Chamada = { tabela: string; metodo: string; args: unknown[] }

/** Admin fake: fila de resultados POR TABELA, consumidos na ordem das chamadas
 * a .from(tabela). O builder é chainável e thenable (como o do supabase-js).
 * `chamadas` (opcional) registra os filtros aplicados, p/ asserções de query. */
function adminMock(filas: Record<string, Resultado[]>, chamadas?: Chamada[]) {
  const restantes: Record<string, Resultado[]> = Object.fromEntries(
    Object.entries(filas).map(([k, v]) => [k, [...v]]),
  )
  return {
    from(tabela: string) {
      const fila = restantes[tabela]
      const resultado: Resultado = fila && fila.length ? (fila.shift() as Resultado) : { data: [] }
      const b: Record<string, unknown> = {}
      for (const m of ['select', 'eq', 'in', 'gte', 'is', 'update', 'upsert']) {
        b[m] = (...args: unknown[]) => {
          chamadas?.push({ tabela, metodo: m, args })
          return b
        }
      }
      b.then = (resolve: (v: Resultado) => void) => resolve(resultado)
      return b
    },
  } as never
}

const AGORA = '2026-07-10T12:00:00Z'
const PROC = { id: 'p1', tenant_id: 't1', numero_cnj: CNJ }
// Cobertura DJEN do tenant t1 desde 1º/junho (cobre as janelas dos testes).
const COBERTURA = { data: [{ tenant_id: 't1', janela_inicio: '2026-06-01' }] }

describe('rodarSentinela — contagens e resiliência (I/O mockado)', () => {
  it('abre alerta para movimento de publicação sem publicação no DJEN', async () => {
    const admin = adminMock({
      processos: [{ data: [PROC] }],
      processo_movimentos: [
        {
          data: [
            { id: 'm1', processo_id: 'p1', nome: 'Publicado o acórdão', data_hora: '2026-07-05T12:00:00Z' },
            { id: 'm2', processo_id: 'p1', nome: 'Juntada de Petição', data_hora: '2026-07-05T12:00:00Z' },
          ],
        },
      ],
      capturas_publicacoes: [COBERTURA],
      sentinela_publicacoes: [
        { data: [] }, // select de alertas abertos
        { data: [{ id: 'a1' }] }, // upsert do alerta novo
      ],
      publicacoes: [{ data: [] }],
    })
    const r = await rodarSentinela(admin, { agora: AGORA })
    expect(r).toEqual({ avaliados: 1, abertos: 1, autoResolvidos: 0 })
  })

  it('NÃO abre alerta sem cobertura DJEN registrada (tenant sem captura de OAB)', async () => {
    const admin = adminMock({
      processos: [{ data: [PROC] }],
      processo_movimentos: [
        { data: [{ id: 'm1', processo_id: 'p1', nome: 'Publicado o acórdão', data_hora: '2026-07-05T12:00:00Z' }] },
      ],
      capturas_publicacoes: [{ data: [] }], // nenhuma captura bem-sucedida
      sentinela_publicacoes: [{ data: [] }],
      publicacoes: [{ data: [] }],
    })
    const r = await rodarSentinela(admin, { agora: AGORA })
    expect(r).toEqual({ avaliados: 1, abertos: 0, autoResolvidos: 0 })
  })

  it('NÃO abre alerta quando a janela do movimento antecede a cobertura DJEN (onboarding/backfill)', async () => {
    // Movimento de 35d atrás (snapshot histórico do DataJud no cadastro), mas a
    // captura DJEN só cobre desde 2026-06-10 — a publicação pode ter saído no
    // DJEN antes da cobertura. Alertar aqui seria falso positivo de onboarding.
    const admin = adminMock({
      processos: [{ data: [PROC] }],
      processo_movimentos: [
        { data: [{ id: 'm1', processo_id: 'p1', nome: 'Publicado o acórdão', data_hora: '2026-06-05T12:00:00Z' }] },
      ],
      capturas_publicacoes: [{ data: [{ tenant_id: 't1', janela_inicio: '2026-06-10' }] }],
      sentinela_publicacoes: [{ data: [] }],
      publicacoes: [{ data: [] }],
    })
    const r = await rodarSentinela(admin, { agora: AGORA })
    expect(r).toEqual({ avaliados: 1, abertos: 0, autoResolvidos: 0 })
  })

  it('exclui movimentos simulados e clientes soft-deletados nas queries', async () => {
    const chamadas: Chamada[] = []
    const admin = adminMock(
      {
        processos: [{ data: [PROC] }],
        processo_movimentos: [{ data: [] }],
        sentinela_publicacoes: [{ data: [] }],
      },
      chamadas,
    )
    await rodarSentinela(admin, { agora: AGORA })
    // Teste on-demand do dono (raw._simulado) nunca vira alerta.
    expect(chamadas).toContainEqual({
      tabela: 'processo_movimentos',
      metodo: 'is',
      args: ['raw->_simulado', null],
    })
    // Processos de clientes excluídos ficam fora (mesmo padrão do sync).
    expect(chamadas).toContainEqual({
      tabela: 'processos',
      metodo: 'is',
      args: ['clientes.deleted_at', null],
    })
  })

  it('NÃO abre alerta na carência (movimento de ontem — DJEN ainda pode indexar)', async () => {
    const admin = adminMock({
      processos: [{ data: [PROC] }],
      processo_movimentos: [
        { data: [{ id: 'm1', processo_id: 'p1', nome: 'Publicação', data_hora: '2026-07-09T12:00:00Z' }] },
      ],
      capturas_publicacoes: [COBERTURA],
      sentinela_publicacoes: [{ data: [] }],
      publicacoes: [{ data: [] }],
    })
    const r = await rodarSentinela(admin, { agora: AGORA })
    expect(r).toEqual({ avaliados: 1, abertos: 0, autoResolvidos: 0 })
  })

  it('NÃO abre alerta quando a publicação correspondente existe (mesmo com máscara)', async () => {
    const admin = adminMock({
      processos: [{ data: [PROC] }],
      processo_movimentos: [
        { data: [{ id: 'm1', processo_id: 'p1', nome: 'Publicação', data_hora: '2026-07-05T12:00:00Z' }] },
      ],
      capturas_publicacoes: [COBERTURA],
      sentinela_publicacoes: [{ data: [] }],
      publicacoes: [
        { data: [{ tenant_id: 't1', numero_processo: CNJ, data_disponibilizacao: '2026-07-06' }] },
      ],
    })
    const r = await rodarSentinela(admin, { agora: AGORA })
    expect(r).toEqual({ avaliados: 1, abertos: 0, autoResolvidos: 0 })
  })

  it('auto-resolve alerta aberto cuja publicação apareceu', async () => {
    const admin = adminMock({
      processos: [{ data: [PROC] }],
      processo_movimentos: [{ data: [] }],
      sentinela_publicacoes: [
        { data: [{ id: 'a1', tenant_id: 't1', numero_processo: CNJ, movimento_data: '2026-07-05T12:00:00Z' }] },
        { data: [{ id: 'a1' }] }, // update de auto-resolução (claim em status=aberta)
      ],
      publicacoes: [
        { data: [{ tenant_id: 't1', numero_processo: CNJ, data_disponibilizacao: '2026-07-06' }] },
      ],
    })
    const r = await rodarSentinela(admin, { agora: AGORA })
    expect(r).toEqual({ avaliados: 0, abertos: 0, autoResolvidos: 1 })
  })

  it('corte das publicações recua para cobrir alerta aberto mais antigo que 48d (auto-resolução tardia)', async () => {
    const chamadas: Chamada[] = []
    const admin = adminMock(
      {
        processos: [{ data: [PROC] }],
        processo_movimentos: [{ data: [] }],
        sentinela_publicacoes: [
          // Alerta pendurado com movimento de ~70d (além do corte fixo de 48d).
          { data: [{ id: 'a1', tenant_id: 't1', numero_processo: CNJ, movimento_data: '2026-05-01T12:00:00Z' }] },
          { data: [{ id: 'a1' }] },
        ],
        publicacoes: [
          { data: [{ tenant_id: 't1', numero_processo: CNJ, data_disponibilizacao: '2026-05-02' }] },
        ],
      },
      chamadas,
    )
    const r = await rodarSentinela(admin, { agora: AGORA })
    expect(r).toEqual({ avaliados: 0, abertos: 0, autoResolvidos: 1 })
    // O corte foi derivado do alerta aberto (mov − 3d), não do teto fixo 48d.
    expect(chamadas).toContainEqual({
      tabela: 'publicacoes',
      metodo: 'gte',
      args: ['data_disponibilizacao', '2026-04-28'],
    })
  })

  it('NUNCA lança — admin que explode vira contagens zeradas', async () => {
    const admin = {
      from() {
        throw new Error('boom')
      },
    } as never
    await expect(rodarSentinela(admin, { agora: AGORA })).resolves.toEqual({
      avaliados: 0,
      abertos: 0,
      autoResolvidos: 0,
    })
  })

  it('sem processos cadastrados → zeros (sem queries desnecessárias)', async () => {
    const admin = adminMock({ processos: [{ data: [] }] })
    const r = await rodarSentinela(admin, { agora: AGORA })
    expect(r).toEqual({ avaliados: 0, abertos: 0, autoResolvidos: 0 })
  })
})
