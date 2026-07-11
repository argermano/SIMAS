import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getAuthContext, requireRole } from '@/lib/auth'
import { jsonError, validateBody } from '@/lib/api'

// PATCH /api/financeiro/parcelas/[id] — edita parcela EM ABERTO
// (descrição/valor/vencimento/processo). Parcela paga/cancelada é imutável.

const ROLES = ['admin', 'advogado', 'colaborador']
const DATA_RE = /^\d{4}-\d{2}-\d{2}$/

const schema = z
  .object({
    descricao: z.string().trim().min(1).max(300).optional(),
    valorCentavos: z.number().int().positive().optional(),
    vencimento: z.string().regex(DATA_RE).optional(),
    processoId: z.string().uuid().nullable().optional(),
  })
  .refine((d) => Object.values(d).some((v) => v !== undefined), { message: 'Nada para atualizar' })

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params

  const auth = await getAuthContext()
  if (!auth.ok) return auth.response
  const gate = requireRole(auth.usuario, ROLES)
  if (gate) return gate
  const { supabase, usuario } = auth

  const parsed = await validateBody(req, schema)
  if (!parsed.ok) return parsed.response
  const dados = parsed.data

  const { data: parcela } = await supabase
    .from('parcelas')
    .select('id, status, vencimento')
    .eq('id', id)
    .eq('tenant_id', usuario.tenant_id)
    .maybeSingle()
  if (!parcela) return jsonError('Parcela não encontrada', 404)
  if (parcela.status !== 'aberta') {
    return jsonError('Só é possível editar parcelas em aberto', 409)
  }

  // A8: processo referenciado precisa pertencer ao tenant.
  if (dados.processoId) {
    const { data: proc } = await supabase
      .from('processos')
      .select('id')
      .eq('id', dados.processoId)
      .eq('tenant_id', usuario.tenant_id)
      .maybeSingle()
    if (!proc) return jsonError('Processo inválido', 400)
  }

  const patch: Record<string, unknown> = {}
  if (dados.descricao !== undefined) patch.descricao = dados.descricao
  if (dados.valorCentavos !== undefined) patch.valor_centavos = dados.valorCentavos
  if (dados.vencimento !== undefined) {
    patch.vencimento = dados.vencimento
    // Vencimento mudou → zera os claims de aviso: o ciclo D-3/D-0 vale para a
    // NOVA data (senão o cliente ficaria sem aviso após uma renegociação).
    // Sem risco de duplicidade: o claim atômico do cron segue valendo.
    if (dados.vencimento !== parcela.vencimento) {
      patch.aviso_d3_em = null
      patch.aviso_d0_em = null
    }
  }
  if (dados.processoId !== undefined) patch.processo_id = dados.processoId

  // Guarda status='aberta' também no WHERE (corrida com baixa/cancelamento).
  const { data: atualizadas, error } = await supabase
    .from('parcelas')
    .update(patch)
    .eq('id', id)
    .eq('tenant_id', usuario.tenant_id)
    .eq('status', 'aberta')
    .select('id, cliente_id, contrato_id, processo_id, descricao, valor_centavos, vencimento, status')
  if (error) return jsonError(error.message, 500)
  if (!atualizadas || atualizadas.length === 0) {
    return jsonError('Só é possível editar parcelas em aberto', 409)
  }

  return NextResponse.json({ parcela: atualizadas[0] })
}
