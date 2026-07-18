import { describe, it, expect } from 'vitest'
import {
  contemData,
  removerDatas,
  trechoConfere,
  sanitizarSugestoes,
} from './sugestoes-prompt'

const TEXTO =
  'Fica a parte intimada da sentença proferida nos autos. O prazo para recurso é de 15 (quinze) dias. Valor da condenação: R$ 10.000,00.'

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

  it('entrada fora de forma vira sugestões vazias (nunca lança)', () => {
    expect(sanitizarSugestoes(null, TEXTO)).toEqual({ trechos: [], tarefas: [], resumo: '' })
    expect(sanitizarSugestoes({ trechos: 'x', tarefas: 3 }, TEXTO)).toEqual({
      trechos: [],
      tarefas: [],
      resumo: '',
    })
  })
})
