import { describe, it, expect, vi, afterEach } from 'vitest'
import { classificarMovimento, sugereEncerramento, CATEGORIAS_NOTIFICAVEIS_DEFAULT, categoriasNotificaveis } from './categorias'
import { hashMovimento, hashMovimentoCanonico, sincronizarProcessos } from './sync'
import { montarTextoAviso } from './notificar'
import { datajudDataParaISO, buscarProcessoCompletoPorNumero } from '@/lib/jurisprudencia/datajud'
import { validarNumeroCNJ, aliasDataJud } from '@/lib/jurisprudencia/verificador-citacoes'
import { chaveTelefone, mesmoTelefone } from '@/lib/funil/telefone'

describe('categorias — classificação de movimentos (TPU + nome)', () => {
  it('classifica trânsito em julgado (por código e por nome)', () => {
    expect(classificarMovimento({ codigo: 848, nome: 'qualquer coisa' })).toBe('transito_julgado')
    expect(classificarMovimento({ codigo: null, nome: 'Trânsito em Julgado' })).toBe('transito_julgado')
  })

  it('classifica sentença / procedência / homologação', () => {
    expect(classificarMovimento({ nome: 'Procedência' })).toBe('sentenca')
    expect(classificarMovimento({ nome: 'Julgamento com Resolução do Mérito - Improcedência' })).toBe('sentenca')
    expect(classificarMovimento({ nome: 'Homologação de Transação' })).toBe('sentenca')
  })

  it('distingue arquivamento definitivo (encerra) de provisório (comum)', () => {
    expect(classificarMovimento({ nome: 'Arquivamento Definitivo' })).toBe('arquivamento')
    expect(classificarMovimento({ codigo: 246, nome: 'Definitivo' })).toBe('arquivamento')
    expect(classificarMovimento({ nome: 'Arquivamento Provisório' })).toBe('movimentacao_comum')
    expect(sugereEncerramento('arquivamento')).toBe(true)
    expect(sugereEncerramento('movimentacao_comum')).toBe(false)
  })

  it('detecta alvará no complemento de "Expedição de documento"', () => {
    expect(
      classificarMovimento({
        nome: 'Expedição de documento',
        complementos: [{ nome: 'tipo_de_documento', descricao: 'Alvará' }],
      }),
    ).toBe('expedicao_alvara')
  })

  it('classifica recurso e audiência', () => {
    expect(classificarMovimento({ nome: 'Recebido o Recurso de Apelação' })).toBe('recurso')
    expect(classificarMovimento({ nome: 'Audiência de Conciliação Designada' })).toBe('audiencia')
  })

  it('cai em movimentação comum e retorna null quando nada casa', () => {
    expect(classificarMovimento({ nome: 'Juntada de Petição' })).toBe('movimentacao_comum')
    expect(classificarMovimento({ nome: 'Conclusão para Despacho' })).toBe('movimentacao_comum')
    expect(classificarMovimento({ nome: 'xyzzy termo inexistente' })).toBeNull()
  })

  it('defaults notificáveis incluem sentença/trânsito/audiência/alvará/recurso/arquivamento', () => {
    expect(CATEGORIAS_NOTIFICAVEIS_DEFAULT).toEqual(
      expect.arrayContaining(['sentenca', 'transito_julgado', 'audiencia', 'expedicao_alvara', 'recurso', 'arquivamento']),
    )
    expect(CATEGORIAS_NOTIFICAVEIS_DEFAULT).not.toContain('movimentacao_comum')
    expect(CATEGORIAS_NOTIFICAVEIS_DEFAULT).not.toContain('decisao_despacho')
  })
})

describe('categorias — config notificável por tenant', () => {
  it('sem config salva usa os defaults', () => {
    const s = categoriasNotificaveis(null)
    expect(s.has('sentenca')).toBe(true)
    expect(s.has('movimentacao_comum')).toBe(false)
  })
  it('respeita a lista salva no tenant.config e ignora slugs inválidos', () => {
    const s = categoriasNotificaveis({ processos_notificar: ['audiencia', 'xxx-invalido'] })
    expect(s.has('audiencia')).toBe(true)
    expect(s.has('sentenca')).toBe(false) // não estava na lista
    expect(s.size).toBe(1)
  })
  it('lista vazia = nada notifica (não cai no default)', () => {
    expect(categoriasNotificaveis({ processos_notificar: [] }).size).toBe(0)
  })
})

describe('notificar — template do aviso', () => {
  it('monta saudação com primeiro nome capitalizado e inclui o resumo', () => {
    const txt = montarTextoAviso({
      clienteNome: 'marta de almeida suenar',
      resumo: 'A decisão se tornou definitiva.',
      nomeTecnico: 'Trânsito em Julgado',
      rotuloProcesso: '0009008-28.2025.8.16.0026',
      escritorioNome: 'Katlen Nardes Germano Advogados',
    })
    expect(txt).toContain('Olá, Marta!')
    expect(txt).toContain('A decisão se tornou definitiva.')
    expect(txt).toContain('0009008-28.2025.8.16.0026')
    expect(txt).toContain('Katlen Nardes Germano Advogados')
  })
  it('usa o nome técnico quando não há resumo, e saudação neutra sem nome', () => {
    const txt = montarTextoAviso({ clienteNome: null, resumo: null, nomeTecnico: 'Audiência Designada', rotuloProcesso: null, escritorioNome: null })
    expect(txt).toContain('Olá!')
    expect(txt).toContain('Audiência Designada')
  })
})

describe('sync — hash de movimento (dedup)', () => {
  it('mesmo registro → mesmo hash; registro diferente → hash diferente', () => {
    const a = { codigo: 60, nome: 'Expedição de documento', dataHora: '2026-03-11T10:00:00' }
    const b = { ...a }
    const c = { ...a, dataHora: '2026-03-12T10:00:00' }
    expect(hashMovimento(a)).toBe(hashMovimento(b))
    expect(hashMovimento(a)).not.toBe(hashMovimento(c))
    expect(hashMovimento(a)).toHaveLength(32) // md5 hex
  })
})

describe('sync — hash canônico (dedup estável do DataJud)', () => {
  const mov = {
    codigo: 60,
    nome: 'Expedição de documento',
    dataHora: '2026-03-11T10:00:00',
    complementos: [{ nome: 'tipo_de_documento', descricao: 'Alvará' }],
  }

  it('é IMUNE à ordem das chaves da projeção e dos complementos', () => {
    const reordenado = {
      complementos: [{ descricao: 'Alvará', nome: 'tipo_de_documento' }], // chaves trocadas
      dataHora: '2026-03-11T10:00:00',
      nome: 'Expedição de documento',
      codigo: 60,
    }
    expect(hashMovimentoCanonico(reordenado)).toBe(hashMovimentoCanonico(mov))
  })

  it('IGNORA campos extras (bump de schema do CNJ não reidrata o hash)', () => {
    // O legado (JSON cru) muda com um campo novo → duplicaria tudo; o canônico não.
    const cru = { ...mov, raw: mov }
    const cruComCampoNovo = { ...mov, raw: mov, movimentoNacional: { seq: 1 } }
    expect(hashMovimento(cruComCampoNovo)).not.toBe(hashMovimento(cru)) // fragilidade do legado
    expect(hashMovimentoCanonico(cruComCampoNovo)).toBe(hashMovimentoCanonico(mov)) // canônico estável
  })

  it('normaliza a data a epoch: mesmo instante em formatos diferentes → mesmo hash', () => {
    // O recompute lê data_hora (timestamptz) num formato ISO possivelmente distinto
    // do enviado no insert; a normalização a epoch faz instantes iguais casarem.
    // (Formatos com tz explícita p/ ser determinístico em qualquer TZ de CI.)
    expect(hashMovimentoCanonico({ ...mov, dataHora: '2026-03-11T10:00:00+00:00' }))
      .toBe(hashMovimentoCanonico({ ...mov, dataHora: '2026-03-11T10:00:00.000Z' }))
  })

  it('distingue movimentos realmente diferentes (data/nome/código)', () => {
    expect(hashMovimentoCanonico({ ...mov, dataHora: '2026-03-12T10:00:00' })).not.toBe(hashMovimentoCanonico(mov))
    expect(hashMovimentoCanonico({ ...mov, nome: 'Sentença' })).not.toBe(hashMovimentoCanonico(mov))
    expect(hashMovimentoCanonico({ ...mov, codigo: 61 })).not.toBe(hashMovimentoCanonico(mov))
    expect(hashMovimentoCanonico(mov)).toHaveLength(32)
  })
})

describe('datajud — normalização de datas', () => {
  it('mantém ISO e converte o formato compacto AAAAMMDDHHmmss', () => {
    expect(datajudDataParaISO('2026-06-10T02:22:33.000Z')).toBe('2026-06-10T02:22:33.000Z')
    expect(datajudDataParaISO('20250730161039')).toBe('2025-07-30T16:10:39')
    expect(datajudDataParaISO('20250730')).toBe('2025-07-30')
    expect(datajudDataParaISO(null)).toBeNull()
    expect(datajudDataParaISO('')).toBeNull()
    expect(datajudDataParaISO(12345)).toBeNull()
  })
})

describe('datajud — distingue não encontrado (0 hits) de erro (5xx) — caso VANIO', () => {
  const numero = '00000000000000000000'
  const originalFetch = global.fetch
  afterEach(() => { global.fetch = originalFetch })

  it("consulta OK com ZERO hits → 'nao_encontrado' (processo novo ainda não indexado)", async () => {
    global.fetch = vi.fn(async () => ({ ok: true, json: async () => ({ hits: { hits: [] } }) })) as unknown as typeof fetch
    const r = await buscarProcessoCompletoPorNumero('tjsc', numero, 1000, 1)
    expect(r).toBe('nao_encontrado')
  })

  it('falha 5xx após as tentativas → null (DataJud indisponível/oscilando)', async () => {
    global.fetch = vi.fn(async () => ({ ok: false, json: async () => ({}) })) as unknown as typeof fetch
    const r = await buscarProcessoCompletoPorNumero('tjsc', numero, 1000, 1)
    expect(r).toBeNull()
  })

  it('200 com hit → ProcessoCompleto (não confunde com os dois desfechos acima)', async () => {
    global.fetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({ hits: { hits: [{ _source: { numeroProcesso: numero, movimentos: [] } }] } }),
    })) as unknown as typeof fetch
    const r = await buscarProcessoCompletoPorNumero('tjsc', numero, 1000, 1)
    expect(r && typeof r === 'object' ? r.numeroProcesso : null).toBe(numero)
  })
})

describe('by-phone — match de telefone (isolamento de dados)', () => {
  it('DDD 55 (Santa Maria/RS) não é confundido com DDI +55 e não colide com outro número', () => {
    // "(55) 99118-6787" (11 dígitos, DDD 55) preserva o DDD na chave
    expect(chaveTelefone('(55) 99118-6787')).toBe('55991186787')
    // NÃO casa com um número de DDD 99 + final igual (o cross-match do bug antigo)
    expect(mesmoTelefone('(55) 99118-6787', '(99) 91186-787')).toBe(false)
  })
  it('mesma linha casa com/sem DDI e com/sem 9º dígito', () => {
    expect(mesmoTelefone('+55 47 99118-6787', '47 99118-6787')).toBe(true)
    expect(mesmoTelefone('5547991186787', '(47) 9118-6787')).toBe(true)
  })
  it('números de pessoas diferentes não casam', () => {
    expect(mesmoTelefone('(47) 99118-6787', '(47) 98888-1234')).toBe(false)
  })
})

describe('CNJ — validação e alias (caso Marta)', () => {
  it('valida o número da Marta e mapeia para TJPR (8.16), não TJSC', () => {
    const marta = '0009008-28.2025.8.16.0026'
    expect(validarNumeroCNJ(marta)).toBe(true)
    expect(aliasDataJud(marta)).toBe('tjpr')
  })

  it('rejeita número com DV inválido', () => {
    expect(validarNumeroCNJ('0009008-99.2025.8.16.0026')).toBe(false)
  })
})

// Mock de admin Supabase que captura os filtros do SELECT de processos e devolve
// fila vazia (sem rede, sem syncUmProcesso): isola a lógica de SELEÇÃO da 059.
function mockAdminSync(vipIds: string[], cap: { eq: [string, unknown][]; or?: string }) {
  const clientes = {
    select() { return clientes },
    neq() { return clientes },
    is() { return Promise.resolve({ data: vipIds.map((id) => ({ id })), error: null }) },
  }
  const processos = {
    select() { return processos },
    eq(col: string, val: unknown) { cap.eq.push([col, val]); return processos },
    or(expr: string) { cap.or = expr; return processos },
    order() { return processos },
    limit() { return Promise.resolve({ data: [], error: null }) },
  }
  return { from(table: string) { return table === 'clientes' ? clientes : processos } } as never
}

describe('sync — seleção da fila (união VIP + sync_pendente, 059)', () => {
  it('com VIPs: usa or(sync_pendente OU cliente_id in) com UUIDs citados', async () => {
    const cap: { eq: [string, unknown][]; or?: string } = { eq: [] }
    const r = await sincronizarProcessos(mockAdminSync(['c1', 'c2'], cap))
    expect(cap.or).toContain('sync_pendente.is.true')
    expect(cap.or).toContain('cliente_id.in.("c1","c2")')
    expect(cap.eq).toContainEqual(['situacao', 'ativo'])
    expect(r).toEqual({ processos: 0, novosMovimentos: 0, consultados: 0, pendentes: 0, enviados: 0 })
  })

  it('sem VIPs: cai só na fila de pendentes (sync_pendente=true), sem or()', async () => {
    const cap: { eq: [string, unknown][]; or?: string } = { eq: [] }
    await sincronizarProcessos(mockAdminSync([], cap))
    expect(cap.or).toBeUndefined()
    expect(cap.eq).toContainEqual(['situacao', 'ativo'])
    expect(cap.eq).toContainEqual(['sync_pendente', true])
  })

  it('somentePendentes (drain pós-DJEN): ignora os VIPs e usa só a fila 059', async () => {
    // Mesmo COM VIPs cadastrados, o drain não pode re-consultá-los (dobraria o
    // polling DataJud): sem or(), só sync_pendente=true.
    const cap: { eq: [string, unknown][]; or?: string } = { eq: [] }
    await sincronizarProcessos(mockAdminSync(['c1', 'c2'], cap), { somentePendentes: true })
    expect(cap.or).toBeUndefined()
    expect(cap.eq).toContainEqual(['situacao', 'ativo'])
    expect(cap.eq).toContainEqual(['sync_pendente', true])
  })
})
