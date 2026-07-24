import { describe, it, expect } from 'vitest'
import { linhaVencimento, montarLinhasAviso } from './notificar-nova-tarefa'

describe('linhaVencimento', () => {
  it('destaca HOJE (caso real do dono: criou com vencimento no dia)', () => {
    expect(linhaVencimento('2026-07-24T00:00:00+00:00', '2026-07-24')).toBe('⚠️ Vence HOJE (24/07/26)')
  })
  it('vencida ganha alerta com a data', () => {
    expect(linhaVencimento('2026-07-20T00:00:00+00:00', '2026-07-24')).toBe('⚠️ VENCIDA desde 20/07/26')
  })
  it('futura mostra a data sem alarde', () => {
    expect(linhaVencimento('2026-07-28T00:00:00+00:00', '2026-07-24')).toBe('Vencimento: 28/07/26')
  })
  it('sem vencimento, sem linha', () => {
    expect(linhaVencimento(null, '2026-07-24')).toBeNull()
  })
})

describe('montarLinhasAviso', () => {
  it('junta vencimento e vínculo, sem URL (o canal acrescenta)', () => {
    const r = montarLinhasAviso({
      descricao: 'Tarefa teste para Anderson',
      dueDate: '2026-07-24T00:00:00+00:00',
      vinculoRotulo: 'DANIEL — Cumprimento de sentença',
      diaHojeSP: '2026-07-24',
    })
    expect(r.titulo).toBe('Nova tarefa para você: Tarefa teste para Anderson')
    expect(r.corpo).toBe('⚠️ Vence HOJE (24/07/26)\nCliente/caso: DANIEL — Cumprimento de sentença')
    expect(r.corpo).not.toContain('http')
  })
  it('sem vencimento nem vínculo, corpo vazio (aviso cai no formato simples)', () => {
    const r = montarLinhasAviso({ descricao: 'X', dueDate: null, vinculoRotulo: null, diaHojeSP: '2026-07-24' })
    expect(r.corpo).toBe('')
  })
})
