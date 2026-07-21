import { describe, it, expect } from 'vitest'
import {
  idEventoGoogle,
  dominioDoEmail,
  emailElegivel,
  decisaoProbe,
  eventosDoCalendarioAntigo,
} from './api'

describe('idEventoGoogle — id estável derivado do id lógico SIMAS', () => {
  it('md5 hex lowercase de 32 chars no charset válido do Google', () => {
    const id = idEventoGoogle('evento:abc-123')
    expect(id).toMatch(/^[0-9a-f]{32}$/) // subconjunto de base32hex (a-v,0-9)
  })

  it('é determinístico: mesmo id lógico ⇒ mesmo id do Google (upsert idempotente)', () => {
    expect(idEventoGoogle('tarefa:t1')).toBe(idEventoGoogle('tarefa:t1'))
  })

  it('ids lógicos distintos ⇒ ids distintos', () => {
    expect(idEventoGoogle('evento:abc-123')).not.toBe(idEventoGoogle('prazo:abc-123'))
    expect(idEventoGoogle('tarefa:t1')).not.toBe(idEventoGoogle('tarefa:t2'))
  })
})

describe('dominioDoEmail — domínio minúsculo ou null', () => {
  it('extrai e normaliza o domínio', () => {
    expect(dominioDoEmail('Katlen@ApoioJuridicoDF.adv.br')).toBe('apoiojuridicodf.adv.br')
    expect(dominioDoEmail('  a@b.com  ')).toBe('b.com')
  })

  it('malformado ou vazio => null', () => {
    expect(dominioDoEmail('')).toBeNull()
    expect(dominioDoEmail(null)).toBeNull()
    expect(dominioDoEmail('sem-arroba')).toBeNull()
    expect(dominioDoEmail('@dominio.com')).toBeNull()
    expect(dominioDoEmail('usuario@')).toBeNull()
  })
})

describe('emailElegivel — mesmo domínio Workspace do impersonador', () => {
  const REF = 'katlen@apoiojuridicodf.adv.br'

  it('mesmo domínio (case-insensitive) é elegível', () => {
    expect(emailElegivel('Anderson@apoiojuridicodf.adv.br', REF)).toBe(true)
  })

  it('domínio diferente (ex.: gmail) NÃO é elegível — fica no feed ICS', () => {
    expect(emailElegivel('alguem@gmail.com', REF)).toBe(false)
  })

  it('e-mail ou referência inválidos => não elegível', () => {
    expect(emailElegivel('', REF)).toBe(false)
    expect(emailElegivel(REF, null)).toBe(false)
    expect(emailElegivel('sem-arroba', REF)).toBe(false)
  })
})

describe('decisaoProbe — reusar × recriar × erro (calendars.get, sem calendarList)', () => {
  it('2xx (alcançável sob o escopo atual) => reusar', () => {
    expect(decisaoProbe(200)).toBe('reusar')
    expect(decisaoProbe(204)).toBe('reusar')
  })

  it('403 (invisível sob app.created) ou 404 (apagado) => recriar', () => {
    expect(decisaoProbe(403)).toBe('recriar')
    expect(decisaoProbe(404)).toBe('recriar')
  })

  it('status inesperado => erro (o chamador lança)', () => {
    expect(decisaoProbe(401)).toBe('erro')
    expect(decisaoProbe(400)).toBe('erro')
    expect(decisaoProbe(500)).toBe('erro')
  })
})

describe('eventosDoCalendarioAntigo — bookkeeping a remover do calendário antigo', () => {
  const rows = [
    { google_event_id: 'g1', calendar_google_id: 'cal-antigo' },
    { google_event_id: 'g2', calendar_google_id: 'cal-antigo' },
    { google_event_id: 'g3', calendar_google_id: 'cal-outro' },
    { google_event_id: 'g4', calendar_google_id: null }, // nunca sincronizado
  ]

  it('filtra só os que ainda apontam para o calendário antigo', () => {
    expect(eventosDoCalendarioAntigo(rows, 'cal-antigo').map((r) => r.google_event_id)).toEqual([
      'g1',
      'g2',
    ])
  })

  it('nenhum aponta para o antigo => lista vazia (null não casa)', () => {
    expect(eventosDoCalendarioAntigo(rows, 'cal-inexistente')).toEqual([])
  })
})
