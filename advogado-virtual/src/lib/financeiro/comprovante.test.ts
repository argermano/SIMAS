import { describe, it, expect } from 'vitest'
import { dadosComprovanteSchema, sugerirParcela, type DadosComprovante } from './comprovante'

describe('dadosComprovanteSchema — validação dos dados extraídos pela IA', () => {
  it('aceita comprovante completo', () => {
    const r = dadosComprovanteSchema.safeParse({
      valorCentavos: 50000,
      dataISO: '2026-07-11',
      pagadorNome: 'Maria Souza',
      banco: 'Banco Inter',
      endToEndId: 'E00416968202607111234abcd',
    })
    expect(r.success).toBe(true)
  })
  it('aceita só os obrigatórios (dados antigos sem recebedor seguem válidos)', () => {
    expect(dadosComprovanteSchema.safeParse({ valorCentavos: 1, dataISO: '2026-01-01' }).success).toBe(true)
  })
  it('aceita os novos campos de recebedor (opcionais)', () => {
    const r = dadosComprovanteSchema.safeParse({
      valorCentavos: 50000,
      dataISO: '2026-07-11',
      recebedorNome: 'Katlen Germano',
      recebedorDoc: '***.456.789-**',
      chaveDestino: 'katlen@adv.br',
    })
    expect(r.success).toBe(true)
  })
  it('rejeita valor não inteiro, valor <= 0 e data fora do ISO', () => {
    expect(dadosComprovanteSchema.safeParse({ valorCentavos: 10.5, dataISO: '2026-01-01' }).success).toBe(false)
    expect(dadosComprovanteSchema.safeParse({ valorCentavos: 0, dataISO: '2026-01-01' }).success).toBe(false)
    expect(dadosComprovanteSchema.safeParse({ valorCentavos: 100, dataISO: '11/07/2026' }).success).toBe(false)
  })
})

describe('sugerirParcela — melhor match (IA só sugere, nunca dá baixa)', () => {
  const dados = (valorCentavos: number, dataISO: string): DadosComprovante => ({ valorCentavos, dataISO })

  it('valor exato vence, mesmo com aproximada de vencimento mais próximo', () => {
    const parcelas = [
      { id: 'aprox-perto', valor_centavos: 50100, vencimento: '2026-07-11' },
      { id: 'exata-longe', valor_centavos: 50000, vencimento: '2026-09-01' },
    ]
    expect(sugerirParcela(dados(50000, '2026-07-11'), parcelas)?.id).toBe('exata-longe')
  })

  it('ambiguidade entre exatas: desempata pelo vencimento mais próximo da data do pagamento', () => {
    const parcelas = [
      { id: 'p1', valor_centavos: 50000, vencimento: '2026-06-10' },
      { id: 'p2', valor_centavos: 50000, vencimento: '2026-07-10' },
      { id: 'p3', valor_centavos: 50000, vencimento: '2026-08-10' },
    ]
    expect(sugerirParcela(dados(50000, '2026-07-12'), parcelas)?.id).toBe('p2')
  })

  it('sem exata: aceita dentro de ±1% do valor pago', () => {
    const parcelas = [
      { id: 'dentro', valor_centavos: 50400, vencimento: '2026-07-15' }, // +0,8%
      { id: 'fora', valor_centavos: 51000, vencimento: '2026-07-15' }, // +2%
    ]
    expect(sugerirParcela(dados(50000, '2026-07-11'), parcelas)?.id).toBe('dentro')
  })

  it('fora da tolerância: null (nada casa)', () => {
    const parcelas = [{ id: 'p', valor_centavos: 60000, vencimento: '2026-07-11' }]
    expect(sugerirParcela(dados(50000, '2026-07-11'), parcelas)).toBeNull()
  })

  it('lista vazia: null', () => {
    expect(sugerirParcela(dados(50000, '2026-07-11'), [])).toBeNull()
  })

  it('empate total (mesmo valor, vencimentos equidistantes): determinístico no mais antigo', () => {
    const parcelas = [
      { id: 'depois', valor_centavos: 50000, vencimento: '2026-07-13' },
      { id: 'antes', valor_centavos: 50000, vencimento: '2026-07-09' },
    ]
    expect(sugerirParcela(dados(50000, '2026-07-11'), parcelas)?.id).toBe('antes')
  })

  it('valores pequenos: tolerância de 1% arredondada não gera falso positivo', () => {
    // pago 30 centavos; 1% = 0,3 → round 0 → só match exato
    const parcelas = [{ id: 'p', valor_centavos: 31, vencimento: '2026-07-11' }]
    expect(sugerirParcela(dados(30, '2026-07-11'), parcelas)).toBeNull()
  })
})
