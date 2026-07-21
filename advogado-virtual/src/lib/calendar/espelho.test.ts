import { describe, it, expect } from 'vitest'
import { eventoParaGoogle, proximoDiaCivil } from './espelho'
import { idEventoGoogle } from './api'
import type { EventoCalendario } from '@/lib/agenda/tipos'

function evento(sobrescreve: Partial<EventoCalendario> = {}): EventoCalendario {
  return {
    id: 'evento:abc-123',
    fonte: 'evento',
    titulo: 'Reunião com cliente',
    inicio: '2026-07-10T18:00:00.000Z',
    fim: '2026-07-10T19:00:00.000Z',
    diaTodo: false,
    status: 'a_concluir',
    prioridade: null,
    responsavel: { id: 'u1', nome: 'Katlen' },
    envolvidos: [],
    processo: null,
    cliente: null,
    cor: '#3b82f6',
    tags: [],
    visibilidade: 'escritorio',
    criadoPor: 'u1',
    meetUrl: null,
    link: '/agenda?evento=abc-123',
    descricao: null,
    local: null,
    ...sobrescreve,
  }
}

describe('proximoDiaCivil — dia civil seguinte (end EXCLUSIVO do all-day)', () => {
  it('avança um dia', () => {
    expect(proximoDiaCivil('2026-07-10')).toBe('2026-07-11')
  })
  it('vira mês e ano corretamente', () => {
    expect(proximoDiaCivil('2026-07-31')).toBe('2026-08-01')
    expect(proximoDiaCivil('2026-12-31')).toBe('2027-01-01')
  })
})

describe('eventoParaGoogle — mapeamento EventoCalendario -> recurso Google', () => {
  it('com hora: start/end em dateTime UTC e id derivado estável', () => {
    const p = eventoParaGoogle(evento())
    expect(p.id).toBe(idEventoGoogle('evento:abc-123'))
    expect(p.summary).toBe('Reunião com cliente')
    expect(p.status).toBe('confirmed')
    expect(p.start).toEqual({ dateTime: '2026-07-10T18:00:00.000Z' })
    expect(p.end).toEqual({ dateTime: '2026-07-10T19:00:00.000Z' })
    expect(p.start.date).toBeUndefined()
  })

  it('com hora SEM fim: end = início (Google exige end)', () => {
    const p = eventoParaGoogle(evento({ fim: null }))
    expect(p.end).toEqual({ dateTime: '2026-07-10T18:00:00.000Z' })
  })

  it('dia-todo: start/end em date com dia civil SP e end EXCLUSIVO (dia+1)', () => {
    // 02:00Z do dia 11 ainda é 23:00 SP do dia 10 (UTC-3).
    const p = eventoParaGoogle(evento({ diaTodo: true, inicio: '2026-07-11T02:00:00.000Z', fim: null }))
    expect(p.start).toEqual({ date: '2026-07-10' })
    expect(p.end).toEqual({ date: '2026-07-11' }) // exclusivo
    expect(p.start.dateTime).toBeUndefined()
  })

  it('cancelado => status cancelled', () => {
    expect(eventoParaGoogle(evento({ status: 'cancelada' })).status).toBe('cancelled')
  })

  it('descrição inclui o link SIMAS absoluto quando urlBase é dada', () => {
    const p = eventoParaGoogle(evento({ descricao: 'observação' }), { urlBase: 'https://simas.app/' })
    expect(p.description).toBe('observação\n\nSIMAS: https://simas.app/agenda?evento=abc-123')
  })

  it('sem descrição: só o link SIMAS', () => {
    const p = eventoParaGoogle(evento(), { urlBase: 'https://simas.app' })
    expect(p.description).toBe('SIMAS: https://simas.app/agenda?evento=abc-123')
  })

  it('local só aparece quando presente', () => {
    expect(eventoParaGoogle(evento()).location).toBeUndefined()
    expect(eventoParaGoogle(evento({ local: 'Fórum' })).location).toBe('Fórum')
  })
})
