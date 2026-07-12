import { NextRequest, NextResponse } from 'next/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { getAuthContext, requireRole } from '@/lib/auth'
import { jsonError } from '@/lib/api'
import { logAudit } from '@/lib/audit'
import { logger } from '@/lib/logger'

// POST /api/financeiro/parcelas/[id]/cancelar — cancela parcela EM ABERTO.
// Claim atômico no WHERE status='aberta' (padrão Fase 5).

const ROLES = ['admin', 'advogado', 'colaborador']

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params

  const auth = await getAuthContext()
  if (!auth.ok) return auth.response
  const gate = requireRole(auth.usuario, ROLES)
  if (gate) return gate
  const { supabase, usuario } = auth

  const { data: parcela } = await supabase
    .from('parcelas')
    .select('id, status, comprovante_recebido_url, comprovante_recebido_dados')
    .eq('id', id)
    .eq('tenant_id', usuario.tenant_id)
    .maybeSingle()
  if (!parcela) return jsonError('Parcela não encontrada', 404)
  if (parcela.status !== 'aberta') {
    return jsonError('Só é possível cancelar parcelas em aberto', 409)
  }

  // mensagemId do staging vira TOMBSTONE de dedup: sem ele, uma reentrega do
  // webhook re-stagearia o comprovante em outra parcela aberta do cliente.
  const stgDados = (parcela.comprovante_recebido_dados ?? {}) as Record<string, unknown>
  const stagedMensagemId = typeof stgDados.mensagemId === 'string' ? stgDados.mensagemId : null

  const { data: canceladas, error } = await supabase
    .from('parcelas')
    .update({
      status: 'cancelada',
      // Parcela cancelada não fica aguardando nada: descarta o staging do
      // comprovante recebido (o arquivo em pendentes/ é removido best-effort),
      // mantendo só o mensagemId como tombstone de dedup.
      comprovante_recebido_em: null,
      comprovante_recebido_url: null,
      comprovante_recebido_dados: stagedMensagemId ? { mensagemId: stagedMensagemId } : null,
    })
    .eq('id', id)
    .eq('tenant_id', usuario.tenant_id)
    .eq('status', 'aberta')
    .select('id, descricao, valor_centavos, vencimento, status')
  if (error) return jsonError(error.message, 500)
  if (!canceladas || canceladas.length === 0) {
    return jsonError('Só é possível cancelar parcelas em aberto', 409)
  }

  // Best-effort: varre TODOS os arquivos de staging pendentes desta parcela
  // (pendentes/<id>-*) — inclui um re-staging concorrente do webhook na janela
  // SELECT→UPDATE. Cancelamento não adota nenhum, então remove todos. Falha não
  // desfaz o cancelamento (já efetivado). LGPD: loga apenas ids.
  const storage = createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  ).storage.from('documentos')
  try {
    const { data: sobras } = await storage.list(`financeiro/${usuario.tenant_id}/pendentes`, {
      search: `${id}-`,
      limit: 100,
    })
    const remover = (sobras ?? []).map((f) => `financeiro/${usuario.tenant_id}/pendentes/${f.name}`)
    if (remover.length > 0) {
      const { error: rmErr } = await storage.remove(remover)
      if (rmErr) logger.warn('financeiro.cancelar.remove_staged_falhou', { parcelaId: id, tenantId: usuario.tenant_id })
    }
  } catch {
    logger.warn('financeiro.cancelar.remove_staged_falhou', { parcelaId: id, tenantId: usuario.tenant_id })
  }

  await logAudit({
    tenantId: usuario.tenant_id,
    userId: usuario.id,
    action: 'financeiro.cancelar',
    resourceType: 'parcela',
    resourceId: id,
  })

  return NextResponse.json({ parcela: canceladas[0] })
}
