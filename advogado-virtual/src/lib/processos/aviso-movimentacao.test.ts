import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { reivindicarEEnviarAviso } from './aviso-movimentacao'
import { enviarAvisoWhatsApp } from './notificar'
import { logAudit } from '@/lib/audit'

vi.mock('./notificar', () => ({ enviarAvisoWhatsApp: vi.fn() }))
vi.mock('@/lib/audit', () => ({ logAudit: vi.fn() }))

const enviarMock = enviarAvisoWhatsApp as unknown as Mock
const logAuditMock = logAudit as unknown as Mock

/** Mock mínimo do admin Supabase que reproduz o claim (2 UPDATEs + .select('id'))
 * e os UPDATEs de marca ('enviada'/'erro'). Registra os patches aplicados. */
function criarMockAdmin(claimVence: boolean) {
  const updates: Array<Record<string, unknown>> = []
  function builder(patch: Record<string, unknown>) {
    // Encadeável (eq→builder), awaitable (then→marca), e select→resultado do claim.
    const b = {
      eq: () => b,
      select: () => {
        updates.push(patch)
        return Promise.resolve({ data: claimVence ? [{ id: 'mov-1' }] : [], error: null })
      },
      then: (resolve: (v: unknown) => void) => {
        updates.push(patch)
        resolve({ data: null, error: null })
      },
    }
    return b
  }
  const admin = { from: () => ({ update: (patch: Record<string, unknown>) => builder(patch) }) }
  return { admin: admin as unknown as SupabaseClient, updates }
}

const base = {
  movimentoId: 'mov-1',
  telefone: '5547999999999',
  texto: 'Olá! Atualização no seu processo.',
  tenantId: 'tenant-1',
  processoId: 'proc-1',
  clienteId: 'cli-1',
  origem: 'datajud' as const,
}

describe('reivindicarEEnviarAviso — claim atômico + envio', () => {
  beforeEach(() => vi.clearAllMocks())

  it('claim perdido (outro processo já pegou) → não envia nem audita', async () => {
    const { admin, updates } = criarMockAdmin(false)
    const desfecho = await reivindicarEEnviarAviso(admin, base)
    expect(desfecho).toBe('perdido')
    expect(enviarMock).not.toHaveBeenCalled()
    expect(logAuditMock).not.toHaveBeenCalled()
    // Só o UPDATE do claim (pendente→aprovada) foi tentado.
    expect(updates).toEqual([{ notif_status: 'aprovada' }])
  })

  it('claim vencido + envio ok → marca "enviada" e audita', async () => {
    enviarMock.mockResolvedValue({ ok: true, id: 'wa-1' })
    const { admin, updates } = criarMockAdmin(true)
    const desfecho = await reivindicarEEnviarAviso(admin, base)
    expect(desfecho).toBe('enviado')
    expect(enviarMock).toHaveBeenCalledExactlyOnceWith(base.telefone, base.texto)
    expect(updates[0]).toEqual({ notif_status: 'aprovada' })
    expect(updates[1]).toMatchObject({ notif_status: 'enviada' })
    expect(updates[1].notif_enviada_em).toBeTruthy()
    expect(logAuditMock).toHaveBeenCalledOnce()
    // LGPD: metadata só com ids + origem (nunca telefone/nome/texto).
    expect(logAuditMock.mock.calls[0][0].metadata).toEqual({
      movimento_id: 'mov-1', cliente_id: 'cli-1', origem: 'datajud',
    })
  })

  it('claim vencido + envio falho → marca "erro" e NÃO audita', async () => {
    enviarMock.mockResolvedValue({ ok: false })
    const { admin, updates } = criarMockAdmin(true)
    const desfecho = await reivindicarEEnviarAviso(admin, base)
    expect(desfecho).toBe('erro')
    expect(enviarMock).toHaveBeenCalledOnce()
    expect(updates[0]).toEqual({ notif_status: 'aprovada' })
    expect(updates[1]).toEqual({ notif_status: 'erro' })
    expect(logAuditMock).not.toHaveBeenCalled()
  })

  it('origem ausente → metadata sem a chave origem (só ids)', async () => {
    enviarMock.mockResolvedValue({ ok: true })
    const { admin } = criarMockAdmin(true)
    await reivindicarEEnviarAviso(admin, { ...base, origem: undefined })
    expect(logAuditMock.mock.calls[0][0].metadata).toEqual({ movimento_id: 'mov-1', cliente_id: 'cli-1' })
  })
})
