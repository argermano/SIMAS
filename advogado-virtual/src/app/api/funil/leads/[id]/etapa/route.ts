import { NextResponse } from 'next/server'
import { getAuthContext } from '@/lib/auth'
import { jsonError } from '@/lib/api'
import { registrarEvento } from '@/lib/funil/leads'
import { LABELS_ETAPA, type EtapaFunil, type MotivoPerda } from '@/lib/funil/regras'

const ETAPAS_VALIDAS = new Set(Object.keys(LABELS_ETAPA))

// PATCH /api/funil/leads/:id/etapa — movimentação HUMANA (UI). Valida as regras
// da spec §5: motivo obrigatório ao perder; valor opcional na proposta.
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const auth = await getAuthContext()
  if (!auth.ok) return auth.response
  const { supabase, usuario } = auth

  const body = (await req.json().catch(() => ({}))) as {
    paraEtapa?: string; motivoPerda?: MotivoPerda; motivoPerdaObs?: string; valorEstimado?: number
  }
  const para = body.paraEtapa as EtapaFunil | undefined
  if (!para || !ETAPAS_VALIDAS.has(para)) return jsonError('Etapa inválida', 400)
  if (para === 'perdido' && !body.motivoPerda) return jsonError('Informe o motivo da perda', 400)

  const { data: lead } = await supabase
    .from('funil_leads')
    .select('id, etapa')
    .eq('id', id)
    .eq('tenant_id', usuario.tenant_id)
    .single()
  if (!lead) return jsonError('Lead não encontrado', 404)

  const de = lead.etapa as EtapaFunil
  if (de === para) return NextResponse.json({ ok: true, lead })

  const patch: Record<string, unknown> = { etapa: para, updated_at: new Date().toISOString() }
  if (para === 'perdido') {
    patch.motivo_perda = body.motivoPerda
    patch.motivo_perda_obs = body.motivoPerdaObs?.trim() || null
  }
  if (para === 'proposta_enviada' && typeof body.valorEstimado === 'number') {
    patch.valor_estimado = body.valorEstimado
  }

  const { data: atualizado, error } = await supabase
    .from('funil_leads')
    .update(patch)
    .eq('id', id)
    .eq('tenant_id', usuario.tenant_id)
    .select('id, etapa')
    .single()
  if (error || !atualizado) return jsonError('Falha ao mover o card', 500)

  await registrarEvento(
    supabase, id, de, para, 'humano', usuario.nome ?? null,
    para === 'perdido' ? `Perdido: ${body.motivoPerda}` : null,
  )

  return NextResponse.json({ ok: true, lead: atualizado })
}
