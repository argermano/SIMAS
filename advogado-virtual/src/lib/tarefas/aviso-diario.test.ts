import { describe, it, expect } from 'vitest'
import {
  janelaDiaSaoPaulo,
  tituloCurtoTarefa,
  montarMensagemAvisoTarefas,
} from './aviso-diario'

describe('janelaDiaSaoPaulo — janela do dia civil em America/Sao_Paulo', () => {
  it('meio-dia UTC → dia de SP com bordas 03:00Z (UTC-3)', () => {
    const j = janelaDiaSaoPaulo(new Date('2026-07-23T12:00:00Z'))
    expect(j.dia).toBe('2026-07-23')
    expect(j.inicioISO).toBe('2026-07-23T03:00:00.000Z')
    expect(j.fimISO).toBe('2026-07-24T03:00:00.000Z')
  })

  it('01:00Z ainda é o dia ANTERIOR em SP (evita o "vira o dia" à noite)', () => {
    // 2026-07-23T01:00Z = 2026-07-22 22:00 em SP → pertence ao dia 22.
    const j = janelaDiaSaoPaulo(new Date('2026-07-23T01:00:00Z'))
    expect(j.dia).toBe('2026-07-22')
    expect(j.inicioISO).toBe('2026-07-22T03:00:00.000Z')
    expect(j.fimISO).toBe('2026-07-23T03:00:00.000Z')
  })

  it('tarefa que vence tarde no BR (início do dia seguinte em UTC) cai no dia certo', () => {
    // due_date 2026-07-23 23:00 BR = 2026-07-24T02:00Z deve estar DENTRO da
    // janela do dia 23 [23T03:00Z, 24T03:00Z).
    const j = janelaDiaSaoPaulo(new Date('2026-07-23T15:00:00Z')) // dia 23 em SP
    const dueTardeBR = new Date('2026-07-24T02:00:00Z').toISOString()
    expect(dueTardeBR >= j.inicioISO && dueTardeBR < j.fimISO).toBe(true)
    // e uma que vence de madrugada BR do dia 23 (23T04:00Z) também entra
    const dueMadrugadaBR = new Date('2026-07-23T04:00:00Z').toISOString()
    expect(dueMadrugadaBR >= j.inicioISO && dueMadrugadaBR < j.fimISO).toBe(true)
    // já 24T03:00Z (início do dia 24 BR) fica FORA (fim exclusivo)
    expect(j.fimISO === new Date('2026-07-24T03:00:00Z').toISOString()).toBe(true)
  })
})

describe('tituloCurtoTarefa', () => {
  it('colapsa espaços/quebras e mantém títulos curtos', () => {
    expect(tituloCurtoTarefa('Cliente x Réu:  ação')).toBe('Cliente x Réu: ação')
    expect(tituloCurtoTarefa('linha1\nlinha2')).toBe('linha1 linha2')
  })

  it('trunca com reticências acima do limite', () => {
    const longo = 'A'.repeat(80)
    const curto = tituloCurtoTarefa(longo, 60)
    expect(curto.length).toBe(60)
    expect(curto.endsWith('…')).toBe(true)
  })
})

describe('montarMensagemAvisoTarefas', () => {
  const url = 'https://simas.app'

  it('saudação com primeiro nome + itens com link por tarefa', () => {
    const texto = montarMensagemAvisoTarefas({
      nome: 'ARIEL Souza',
      tarefas: [
        { id: 't1', description: 'Contestação — Fulano' },
        { id: 't2', description: 'Réplica — Beltrano' },
      ],
      urlBase: url,
    })
    expect(texto).toBe(
      [
        'Bom dia, Ariel! Suas tarefas de hoje no SIMAS:',
        '',
        '• Contestação — Fulano → https://simas.app/tarefas?task=t1',
        '• Réplica — Beltrano → https://simas.app/tarefas?task=t2',
      ].join('\n'),
    )
  })

  it('sem nome → saudação genérica', () => {
    const texto = montarMensagemAvisoTarefas({ nome: null, tarefas: [{ id: 'x', description: 'Tarefa' }], urlBase: url })
    expect(texto.startsWith('Bom dia! Suas tarefas de hoje no SIMAS:')).toBe(true)
  })

  it('mais de 10 tarefas → mostra 10 e "...e mais N"', () => {
    const tarefas = Array.from({ length: 13 }, (_, i) => ({ id: `t${i}`, description: `Tarefa ${i}` }))
    const texto = montarMensagemAvisoTarefas({ nome: 'Jessica', tarefas, urlBase: url })
    const itens = texto.split('\n').filter((l) => l.startsWith('• '))
    expect(itens).toHaveLength(10)
    expect(texto.endsWith('...e mais 3')).toBe(true)
  })

  it('urlBase com barra final não gera barra dupla', () => {
    const texto = montarMensagemAvisoTarefas({ nome: 'X', tarefas: [{ id: 'a', description: 'T' }], urlBase: 'https://simas.app/' })
    expect(texto).toContain('https://simas.app/tarefas?task=a')
    expect(texto).not.toContain('simas.app//tarefas')
  })
})
