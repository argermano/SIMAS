import { NextResponse } from 'next/server'
import { getAuthContext } from '@/lib/auth'
import { jsonError } from '@/lib/api'
import { logAudit } from '@/lib/audit'
import { registrarEvento } from '@/lib/funil/leads'
import { cadastroCompleto, LABELS_ETAPA, type EtapaFunil, type MotivoPerda } from '@/lib/funil/regras'

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
    .select('id, etapa, cliente_id')
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

  // Promoção do cliente ao fechar contrato: pré-cadastro → ativo, apenas se o
  // cadastro estiver completo (nome + CPF + endereço). Se incompleto, a UI leva
  // o usuário a "Completar cadastro" em /clientes/{id}. logAudit para trilha.
  let clientePromovido = false
  if (para === 'contrato_fechado') {
    const { data: cliente } = await supabase
      .from('clientes')
      .select('id, nome, cpf, endereco, status_cadastro')
      .eq('id', lead.cliente_id)
      .single()
    if (cliente && cliente.status_cadastro !== 'ativo' && cadastroCompleto(cliente)) {
      const { error: promErr } = await supabase
        .from('clientes')
        .update({ status_cadastro: 'ativo' })
        .eq('id', cliente.id)
        .eq('tenant_id', usuario.tenant_id)
      if (!promErr) {
        clientePromovido = true
        await logAudit({
          tenantId: usuario.tenant_id,
          userId: usuario.id,
          action: 'cliente.promover',
          resourceType: 'cliente',
          resourceId: cliente.id,
          metadata: { origem: 'funil', lead_id: id, de_status: cliente.status_cadastro },
        })
      }
    }
  }

  return NextResponse.json({ ok: true, lead: atualizado, clientePromovido })
}
