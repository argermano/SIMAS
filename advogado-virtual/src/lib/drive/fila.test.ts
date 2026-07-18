import { describe, it, expect, vi, afterEach } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { enfileirarDriveSync } from './fila'

// Client Supabase falso: expõe os spies de from/upsert para inspeção.
function fakeClient() {
  const upsert = vi.fn().mockResolvedValue({ error: null })
  const from = vi.fn(() => ({ upsert }))
  return { client: { from } as unknown as SupabaseClient, from, upsert }
}

function ligarEspelho() {
  process.env.GOOGLE_DRIVE_SA_KEY_BASE64 = 'x' // presença basta (driveDisponivel só checa envs)
  process.env.GOOGLE_DRIVE_PASTA_RAIZ = 'raiz'
}

describe('enfileirarDriveSync — gatilho barato do espelho', () => {
  afterEach(() => {
    delete process.env.GOOGLE_DRIVE_SA_KEY_BASE64
    delete process.env.GOOGLE_DRIVE_PASTA_RAIZ
    vi.restoreAllMocks()
  })

  it('no-op silencioso quando o espelho está inerte (sem as envs)', async () => {
    const { client, from } = fakeClient()
    await enfileirarDriveSync(client, 't1', 'c1')
    expect(from).not.toHaveBeenCalled()
  })

  it('enfileira com dedup (upsert onConflict cliente_id) quando configurado', async () => {
    ligarEspelho()
    const { client, from, upsert } = fakeClient()
    await enfileirarDriveSync(client, 't1', 'c1')
    expect(from).toHaveBeenCalledWith('drive_sync_fila')
    expect(upsert).toHaveBeenCalledWith(
      { cliente_id: 'c1', tenant_id: 't1' },
      { onConflict: 'cliente_id', ignoreDuplicates: true },
    )
  })

  it('ignora quando clienteId/tenantId está ausente', async () => {
    ligarEspelho()
    const { client, from } = fakeClient()
    await enfileirarDriveSync(client, 't1', null)
    await enfileirarDriveSync(client, null, 'c1')
    expect(from).not.toHaveBeenCalled()
  })

  it('nunca lança se o client falhar (try/catch total)', async () => {
    ligarEspelho()
    vi.spyOn(console, 'error').mockImplementation(() => {}) // silencia o log do catch
    const client = {
      from: () => ({ upsert: () => { throw new Error('boom') } }),
    } as unknown as SupabaseClient
    await expect(enfileirarDriveSync(client, 't1', 'c1')).resolves.toBeUndefined()
  })
})
