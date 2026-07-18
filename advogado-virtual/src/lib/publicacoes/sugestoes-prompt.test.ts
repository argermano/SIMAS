import { describe, it, expect } from 'vitest'
import {
  contemData,
  removerDatas,
  trechoConfere,
  sanitizarSugestoes,
  validarDataSugerida,
  cacheAtual,
  SUGESTOES_VERSAO,
} from './sugestoes-prompt'

const TEXTO =
  'Fica a parte intimada da sentença proferida nos autos. O prazo para recurso é de 15 (quinze) dias. Valor da condenação: R$ 10.000,00.'

// Data fixa para tornar a janela de validação de datas determinística nos testes.
const AGORA = new Date('2026-07-18T12:00:00Z')

describe('trechoConfere — citação só vale se for substring EXATA (indexOf)', () => {
  it('aceita substring literal', () => {
    expect(trechoConfere(TEXTO, 'O prazo para recurso é de 15 (quinze) dias.')).toBe(true)
  })
  it('rejeita citação parafraseada/inexistente', () => {
    expect(trechoConfere(TEXTO, 'prazo de quinze dias corridos')).toBe(false)
  })
  it('rejeita string vazia', () => {
    expect(trechoConfere(TEXTO, '')).toBe(false)
  })
})

describe('contemData / removerDatas — a IA nunca emite DATA', () => {
  it('detecta dd/mm/aaaa, ISO e por extenso', () => {
    expect(contemData('protocolar até 25/07/2026')).toBe(true)
    expect(contemData('vence em 2026-07-25')).toBe(true)
    expect(contemData('audiência em 15 de janeiro de 2026')).toBe(true)
  })
  it('não detecta texto sem data', () => {
    expect(contemData('interpor recurso cabível')).toBe(false)
  })
  it('remove a data do título e limpa o conectivo pendurado', () => {
    const limpo = removerDatas('Protocolar recurso até 25/07/2026')
    expect(contemData(limpo)).toBe(false)
    expect(limpo).toBe('Protocolar recurso')
  })
})

describe('sanitizarSugestoes — validação server-side', () => {
  it('mantém só trechos que casam por substring e normaliza motivo desconhecido', () => {
    const raw = {
      trechos: [
        { texto: 'O prazo para recurso é de 15 (quinze) dias.', motivo: 'prazo' },
        { texto: 'trecho que NÃO está no texto', motivo: 'decisao' },
        { texto: 'Valor da condenação: R$ 10.000,00.', motivo: 'inexistente' },
      ],
      tarefas: [],
      resumo: 'Sentença publicada.',
    }
    const out = sanitizarSugestoes(raw, TEXTO)
    expect(out.trechos).toHaveLength(2)
    expect(out.trechos[0]).toEqual({ texto: 'O prazo para recurso é de 15 (quinze) dias.', motivo: 'prazo' })
    // motivo fora do conjunto vira 'outro'
    expect(out.trechos[1].motivo).toBe('outro')
    expect(out.resumo).toBe('Sentença publicada.')
  })

  it('REJEITA qualquer campo de data injetado numa tarefa (whitelist)', () => {
    const raw = {
      trechos: [],
      tarefas: [
        {
          titulo: 'Interpor recurso',
          prioridade: 'alta',
          temPrazoNoTexto: true,
          // Campos de data que a IA tentou contrabandear — NÃO podem sair:
          data: '2026-07-25',
          dueDate: '2026-07-25',
          prazo: '25/07/2026',
          vencimento: '25/07/2026',
        },
      ],
      resumo: '',
    }
    const out = sanitizarSugestoes(raw, TEXTO)
    expect(out.tarefas).toHaveLength(1)
    const t = out.tarefas[0] as unknown as Record<string, unknown>
    expect(t.data).toBeUndefined()
    expect(t.dueDate).toBeUndefined()
    expect(t.prazo).toBeUndefined()
    expect(t.vencimento).toBeUndefined()
    // Sem citação válida de prazo, temPrazoNoTexto cai para false (nada alucinado).
    expect(out.tarefas[0].temPrazoNoTexto).toBe(false)
    expect(out.tarefas[0].trechoDoPrazo).toBeUndefined()
  })

  it('remove data do TÍTULO da tarefa (nunca deixa a IA emitir data)', () => {
    const raw = {
      trechos: [],
      tarefas: [{ titulo: 'Protocolar recurso até 25/07/2026', prioridade: 'media', temPrazoNoTexto: false }],
      resumo: '',
    }
    const out = sanitizarSugestoes(raw, TEXTO)
    expect(contemData(out.tarefas[0].titulo)).toBe(false)
    expect(out.tarefas[0].titulo).toBe('Protocolar recurso')
  })

  it('mantém trechoDoPrazo só se for citação literal; atrela temPrazoNoTexto a ele', () => {
    const raw = {
      trechos: [],
      tarefas: [
        {
          titulo: 'Interpor recurso',
          prioridade: 'alta',
          temPrazoNoTexto: true,
          trechoDoPrazo: 'O prazo para recurso é de 15 (quinze) dias.',
        },
        {
          titulo: 'Cumprir obrigação',
          prioridade: 'baixa',
          temPrazoNoTexto: true,
          trechoDoPrazo: 'prazo inventado de 30 dias',
        },
      ],
      resumo: '',
    }
    const out = sanitizarSugestoes(raw, TEXTO)
    // 1ª: citação confere → mantém e temPrazoNoTexto=true
    expect(out.tarefas[0].temPrazoNoTexto).toBe(true)
    expect(out.tarefas[0].trechoDoPrazo).toBe('O prazo para recurso é de 15 (quinze) dias.')
    // 2ª: citação não confere → descarta trechoDoPrazo e temPrazoNoTexto=false
    expect(out.tarefas[1].temPrazoNoTexto).toBe(false)
    expect(out.tarefas[1].trechoDoPrazo).toBeUndefined()
  })

  it('entrada fora de forma vira sugestões vazias (nunca lança) e carimba a versão', () => {
    expect(sanitizarSugestoes(null, TEXTO)).toEqual({ v: SUGESTOES_VERSAO, trechos: [], tarefas: [], resumo: '' })
    expect(sanitizarSugestoes({ trechos: 'x', tarefas: 3 }, TEXTO)).toEqual({
      v: SUGESTOES_VERSAO,
      trechos: [],
      tarefas: [],
      resumo: '',
    })
  })
})

describe('validarDataSugerida — formato YYYY-MM-DD + janela [hoje-30d, hoje+2anos]', () => {
  it('aceita data no formato válido dentro da janela', () => {
    expect(validarDataSugerida('2026-07-31', AGORA)).toBe('2026-07-31')
  })
  it('rejeita formato inválido (dd/mm/aaaa, ISO curto, lixo)', () => {
    expect(validarDataSugerida('31/07/2026', AGORA)).toBeNull()
    expect(validarDataSugerida('2026-7-1', AGORA)).toBeNull()
    expect(validarDataSugerida('amanhã', AGORA)).toBeNull()
  })
  it('rejeita data de calendário impossível', () => {
    expect(validarDataSugerida('2026-02-30', AGORA)).toBeNull()
    expect(validarDataSugerida('2026-13-01', AGORA)).toBeNull()
  })
  it('rejeita valor não-string', () => {
    expect(validarDataSugerida(20260731, AGORA)).toBeNull()
    expect(validarDataSugerida(null, AGORA)).toBeNull()
    expect(validarDataSugerida(undefined, AGORA)).toBeNull()
  })
  it('respeita as bordas da janela (hoje-30d e hoje+2anos inclusive)', () => {
    expect(validarDataSugerida('2026-06-18', AGORA)).toBe('2026-06-18') // exatamente -30d
    expect(validarDataSugerida('2026-06-17', AGORA)).toBeNull() // 1 dia antes do piso
    expect(validarDataSugerida('2028-07-18', AGORA)).toBe('2028-07-18') // exatamente +2 anos
    expect(validarDataSugerida('2028-07-19', AGORA)).toBeNull() // 1 dia após o teto
  })
})

describe('sanitizarSugestoes — data sugerida + fundamento (v2)', () => {
  it('mantém dataSugerida válida e o fundamento quando há prazo claro', () => {
    const raw = {
      trechos: [],
      tarefas: [{
        titulo: 'Interpor recurso',
        prioridade: 'alta',
        temPrazoNoTexto: true,
        trechoDoPrazo: 'O prazo para recurso é de 15 (quinze) dias.',
        dataSugerida: '2026-08-08',
        fundamentoPrazo: '15 dias úteis a partir de 18/07, art. 1.003 §5º CPC',
      }],
      resumo: '',
    }
    const out = sanitizarSugestoes(raw, TEXTO, AGORA)
    expect(out.v).toBe(SUGESTOES_VERSAO)
    expect(out.tarefas[0].dataSugerida).toBe('2026-08-08')
    expect(out.tarefas[0].fundamentoPrazo).toBe('15 dias úteis a partir de 18/07, art. 1.003 §5º CPC')
  })

  it('descarta dataSugerida fora da janela mas PRESERVA o fundamento', () => {
    const raw = {
      trechos: [],
      tarefas: [{
        titulo: 'Interpor recurso',
        prioridade: 'alta',
        temPrazoNoTexto: true,
        trechoDoPrazo: 'O prazo para recurso é de 15 (quinze) dias.',
        dataSugerida: '2035-01-01', // muito além de +2 anos
        fundamentoPrazo: 'contagem incerta — confira',
      }],
      resumo: '',
    }
    const out = sanitizarSugestoes(raw, TEXTO, AGORA)
    expect(out.tarefas[0].dataSugerida).toBeUndefined()
    expect(out.tarefas[0].fundamentoPrazo).toBe('contagem incerta — confira')
    expect(out.tarefas[0].temPrazoNoTexto).toBe(true)
  })

  it('descarta a data quando falta o fundamento (nunca uma data "nua")', () => {
    const raw = {
      trechos: [],
      tarefas: [{
        titulo: 'Interpor recurso',
        prioridade: 'alta',
        temPrazoNoTexto: true,
        trechoDoPrazo: 'O prazo para recurso é de 15 (quinze) dias.',
        dataSugerida: '2026-08-08', // válida, mas sem fundamento que a justifique
      }],
      resumo: '',
    }
    const out = sanitizarSugestoes(raw, TEXTO, AGORA)
    expect(out.tarefas[0].temPrazoNoTexto).toBe(true)
    expect(out.tarefas[0].fundamentoPrazo).toBeUndefined()
    expect(out.tarefas[0].dataSugerida).toBeUndefined()
  })

  it('ignora dataSugerida/fundamento quando NÃO há prazo claro (citação não confere)', () => {
    const raw = {
      trechos: [],
      tarefas: [{
        titulo: 'Cumprir obrigação',
        prioridade: 'media',
        temPrazoNoTexto: true,
        trechoDoPrazo: 'prazo inventado de 30 dias', // não é substring de TEXTO
        dataSugerida: '2026-08-08',
        fundamentoPrazo: 'inventado',
      }],
      resumo: '',
    }
    const out = sanitizarSugestoes(raw, TEXTO, AGORA)
    expect(out.tarefas[0].temPrazoNoTexto).toBe(false)
    expect(out.tarefas[0].trechoDoPrazo).toBeUndefined()
    expect(out.tarefas[0].dataSugerida).toBeUndefined()
    expect(out.tarefas[0].fundamentoPrazo).toBeUndefined()
  })
})

describe('cacheAtual — só aproveita cache da VERSÃO corrente (v1 invalida)', () => {
  it('trata payload v1 (sem v) como ausente', () => {
    expect(cacheAtual({ trechos: [], tarefas: [], resumo: '' })).toBe(false)
  })
  it('aceita payload da versão corrente', () => {
    expect(cacheAtual({ v: SUGESTOES_VERSAO, trechos: [], tarefas: [], resumo: '' })).toBe(true)
    expect(cacheAtual(sanitizarSugestoes(null, TEXTO, AGORA))).toBe(true)
  })
  it('rejeita nulo/valor fora de forma', () => {
    expect(cacheAtual(null)).toBe(false)
    expect(cacheAtual('x')).toBe(false)
    expect(cacheAtual({ v: 1 })).toBe(false)
  })
})
