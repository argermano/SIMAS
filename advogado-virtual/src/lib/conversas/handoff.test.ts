import { describe, it, expect } from 'vitest'
import { HANDOFF_LABEL, transferidaPeloBot, transferidaPendente } from './handoff'

describe('transferidaPeloBot', () => {
  it('label presente + status aberto → true', () => {
    expect(transferidaPeloBot({ labels: [HANDOFF_LABEL], status: 'open' })).toBe(true)
    // Convive com outras etiquetas.
    expect(transferidaPeloBot({ labels: ['vip', HANDOFF_LABEL], status: 'open' })).toBe(true)
  })

  it('label presente mas conversa resolvida → false', () => {
    expect(transferidaPeloBot({ labels: [HANDOFF_LABEL], status: 'resolved' })).toBe(false)
  })

  it('sem a etiqueta de handoff → false', () => {
    expect(transferidaPeloBot({ labels: ['vip'], status: 'open' })).toBe(false)
  })

  it('labels ausente ou vazio (relay antigo) → false', () => {
    expect(transferidaPeloBot({ status: 'open' })).toBe(false)
    expect(transferidaPeloBot({ labels: [], status: 'open' })).toBe(false)
  })

  it('status ausente + label → true (default não-resolvido)', () => {
    expect(transferidaPeloBot({ labels: [HANDOFF_LABEL] })).toBe(true)
  })
})

describe('transferidaPendente', () => {
  it('transferida e sem assignee → true', () => {
    expect(transferidaPendente({ labels: [HANDOFF_LABEL], status: 'open', assignee: null })).toBe(true)
    expect(transferidaPendente({ labels: [HANDOFF_LABEL], status: 'open' })).toBe(true)
  })

  it('transferida mas já assumida → false', () => {
    expect(
      transferidaPendente({ labels: [HANDOFF_LABEL], status: 'open', assignee: { id: 1, nome: 'Marta' } }),
    ).toBe(false)
  })

  it('não transferida → false mesmo sem assignee', () => {
    expect(transferidaPendente({ labels: [], status: 'open', assignee: null })).toBe(false)
  })
})
