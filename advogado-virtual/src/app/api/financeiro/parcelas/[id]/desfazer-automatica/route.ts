import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getAuthContext, requireRole } from '@/lib/auth'
import { jsonError } from '@/lib/api'
import { logAudit } from '@/lib/audit'

// POST /api/financeiro/parcelas/[id]/desfazer-automatica — DESFAZ uma baixa
// AUTOMÁTICA (migration 077): reverte a parcela para 'aberta' e reconstrói o
// staging a partir do comprovante já vinculado — ele volta a ser "sugestão
// pendente" (estado "aguardando baixa"), para conferência humana. NÃO apaga o
// arquivo do bucket (vira o comprovante recebido de novo). Só admin/advogado.
// Claim ATÔMICO no WHERE status='paga' AND baixa_automatica=true: um DESFAZER
// concorrente (ou uma baixa que já não é automática) não reverte duas vezes.
// LGPD: audit só com ids.

const ROLES = ['admin', 'advogado']

// Corpo vazio esperado; z.object({}).strict() aceita {} e rejeita chaves extras.
const schema = z.object({}).strict()

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params

  const auth = await getAuthContext()
  if (!auth.ok) return auth.response
  const gate = requireRole(auth.usuario, ROLES)
  if (gate) return gate
  const { supabase, usuario } = auth

  // Corpo é opcional/vazio; valida com zod mesmo assim (nenhuma chave extra).
  const raw = await req.json().catch(() => ({}))
  const parsed = schema.safeParse(raw ?? {})
  if (!parsed.success) return jsonError('Dados inválidos', 400, parsed.error.flatten())

  const { data: parcela } = await supabase
    .from('parcelas')
    .select('id, status, baixa_automatica, comprovante_url, comprovante_dados')
    .eq('id', id)
    .eq('tenant_id', usuario.tenant_id)
    .maybeSingle()
  if (!parcela) return jsonError('Parcela não encontrada', 404)
  if (parcela.status !== 'paga' || parcela.baixa_automatica !== true) {
    return jsonError('Esta baixa não é automática ou já foi desfeita', 409)
  }

  // Reconstrói o staging: o comprovante oficial volta a ser o "comprovante
  // recebido" pendente (mesmo path no bucket, mesmos dados da IA). Assim o fluxo
  // humano de conferência (Conferir baixa / comprovante-pendente) reassume.
  const { data: revertidas, error } = await supabase
    .from('parcelas')
    .update({
      status: 'aberta',
      pago_em: null,
      pago_valor_centavos: null,
      meio: null,
      comprovante_url: null,
      comprovante_dados: null,
      baixa_por: null,
      baixa_obs: null,
      baixa_automatica: false,
      comprovante_recebido_em: new Date().toISOString(),
      comprovante_recebido_url: parcela.comprovante_url,
      comprovante_recebido_dados: parcela.comprovante_dados,
    })
    .eq('id', id)
    .eq('tenant_id', usuario.tenant_id)
    .eq('status', 'paga')
    .eq('baixa_automatica', true)
    .select('id')
  if (error) return jsonError(error.message, 500)
  if (!revertidas || revertidas.length === 0) {
    return jsonError('Baixa automática já desfeita ou parcela alterada', 409)
  }

  await logAudit({
    tenantId: usuario.tenant_id,
    userId: usuario.id,
    action: 'financeiro.baixa_automatica_desfeita',
    resourceType: 'parcela',
    resourceId: id,
  })

  return NextResponse.json({ ok: true })
}
