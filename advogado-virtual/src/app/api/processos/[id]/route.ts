import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { getAuthContext, requireRole } from '@/lib/auth'
import { jsonError, validateBody } from '@/lib/api'
import { logAudit } from '@/lib/audit'
import { createClient } from '@/lib/supabase/server'
import { sincronizarProcessoPorId } from '@/lib/processos/sync'

export const maxDuration = 60 // PATCH pode disparar ressincronização (DataJud + IA)

function adminClient() {
  return createAdminClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
}

async function buscarProcesso(
  supabase: Awaited<ReturnType<typeof createClient>>,
  id: string,
  tenantId: string,
) {
  const { data } = await supabase.from('processos').select('*').eq('id', id).eq('tenant_id', tenantId).single()
  return data
}

// GET /api/processos/[id] — capa + timeline de movimentações
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await getAuthContext()
  if (!auth.ok) return auth.response
  const { supabase, usuario } = auth
  const { id } = await params

  const processo = await buscarProcesso(supabase, id, usuario.tenant_id)
  if (!processo) return jsonError('Processo não encontrado.', 404)

  const { data: movimentos, error } = await supabase
    .from('processo_movimentos')
    .select('id, codigo, nome, data_hora, complementos, resumo_ia, categoria, notif_status, created_at')
    .eq('processo_id', id)
    .order('data_hora', { ascending: false, nullsFirst: false })

  if (error) return jsonError(error.message, 500)
  return NextResponse.json({ processo, movimentos: movimentos ?? [] })
}

const schemaPatch = z.object({
  apelido: z.string().max(120).optional().nullable(),
  situacao: z.enum(['ativo', 'encerrado']).optional(),
  ressincronizar: z.boolean().optional(),
})

// PATCH /api/processos/[id] — edita apelido/situação e/ou força ressincronização
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await getAuthContext()
  if (!auth.ok) return auth.response
  const { supabase, usuario } = auth
  const { id } = await params

  const processo = await buscarProcesso(supabase, id, usuario.tenant_id)
  if (!processo) return jsonError('Processo não encontrado.', 404)

  const parsed = await validateBody(req, schemaPatch)
  if (!parsed.ok) return parsed.response
  const { apelido, situacao, ressincronizar } = parsed.data

  const patch: Record<string, unknown> = {}
  if (apelido !== undefined) patch.apelido = apelido?.trim() || null
  if (situacao !== undefined) patch.situacao = situacao

  if (Object.keys(patch).length) {
    const { error } = await supabase.from('processos').update(patch).eq('id', id).eq('tenant_id', usuario.tenant_id)
    if (error) return jsonError(error.message, 500)
  }

  let novosMovimentos: number | undefined
  let sincronizado: boolean | undefined
  let naoEncontrado: boolean | undefined
  if (ressincronizar) {
    try {
      const admin = adminClient()
      const r = await sincronizarProcessoPorId(admin, id)
      if (r === 'nao_encontrado') {
        // Tribunal ainda não indexou o processo (novo): mantém na fila durável (059)
        // para o cron retentar todo dia — sync_pendente só limpa em sucesso.
        sincronizado = false
        naoEncontrado = true
        await admin.from('processos').update({ sync_pendente: true }).eq('id', id)
      } else {
        sincronizado = !!r // null = DataJud indisponível/oscilando
        novosMovimentos = r?.novos ?? 0
      }
    } catch {
      sincronizado = false
    }
  }

  const { data: atual } = await supabase.from('processos').select('*').eq('id', id).single()
  return NextResponse.json({ processo: atual, novosMovimentos, sincronizado, naoEncontrado })
}

// DELETE /api/processos/[id] — desvincula/exclui o processo (cascade nos movimentos)
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await getAuthContext()
  if (!auth.ok) return auth.response
  const { supabase, usuario } = auth
  const gate = requireRole(usuario, ['admin', 'advogado'])
  if (gate) return gate
  const { id } = await params

  const processo = await buscarProcesso(supabase, id, usuario.tenant_id)
  if (!processo) return jsonError('Processo não encontrado.', 404)

  const { error } = await supabase.from('processos').delete().eq('id', id).eq('tenant_id', usuario.tenant_id)
  if (error) return jsonError(error.message, 500)

  await logAudit({
    tenantId: usuario.tenant_id,
    userId: usuario.id,
    action: 'processo.excluir',
    resourceType: 'processo',
    resourceId: id,
    metadata: { numero_cnj: processo.numero_cnj },
  })

  return NextResponse.json({ ok: true })
}
