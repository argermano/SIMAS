import { describe, it, expect, vi, afterEach } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { enfileirarCalendarSync } from './fila'

// Client Supabase falso: expõe os spies de from/upsert para inspeção.
function fakeClient() {
  const upsert = vi.fn().mockResolvedValue({ error: null })
  const from = vi.fn(() => ({ upsert }))
  return { client: { from } as unknown as SupabaseClient, from, upsert }
}

function ligarEspelho() {
  process.env.GOOGLE_DRIVE_SA_KEY_BASE64 = 'x' // presença basta (calendarDisponivel só checa envs)
  process.env.GOOGLE_DRIVE_IMPERSONATE = 'katlen@apoiojuridicodf.adv.br'
}

describe('enfileirarCalendarSync — gatilho barato do espelho ativo', () => {
  afterEach(() => {
    delete process.env.GOOGLE_DRIVE_SA_KEY_BASE64
    delete process.env.GOOGLE_DRIVE_IMPERSONATE
    vi.restoreAllMocks()
  })

  it('no-op silencioso quando o espelho está inerte (sem as envs)', async () => {
    const { client, from } = fakeClient()
    const ids = await enfileirarCalendarSync(client, 't1', ['u1'])
    expect(from).not.toHaveBeenCalled()
    expect(ids).toEqual([])
  })

  it('enfileira com dedup (upsert onConflict user_id) e devolve os ids únicos', async () => {
    ligarEspelho()
    const { client, from, upsert } = fakeClient()
    const ids = await enfileirarCalendarSync(client, 't1', ['u1', 'u2', 'u1', null, undefined])
    expect(from).toHaveBeenCalledWith('calendar_sync_fila')
    expect(upsert).toHaveBeenCalledWith(
      [
        { user_id: 'u1', tenant_id: 't1' },
        { user_id: 'u2', tenant_id: 't1' },
      ],
      { onConflict: 'user_id', ignoreDuplicates: true },
    )
    expect(ids).toEqual(['u1', 'u2'])
  })

  it('ignora quando não há tenant ou não há usuários', async () => {
    ligarEspelho()
    const { client, from } = fakeClient()
    expect(await enfileirarCalendarSync(client, null, ['u1'])).toEqual([])
    expect(await enfileirarCalendarSync(client, 't1', [null, undefined])).toEqual([])
    expect(from).not.toHaveBeenCalled()
  })

  it('nunca lança se o client falhar (try/catch total)', async () => {
    ligarEspelho()
    vi.spyOn(console, 'error').mockImplementation(() => {}) // silencia o log do catch
    const client = {
      from: () => ({ upsert: () => { throw new Error('boom') } }),
    } as unknown as SupabaseClient
    await expect(enfileirarCalendarSync(client, 't1', ['u1'])).resolves.toEqual([])
  })
})
