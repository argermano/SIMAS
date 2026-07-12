import { NextRequest, NextResponse } from 'next/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { getAuthContext, requireRole } from '@/lib/auth'
import { jsonError } from '@/lib/api'
import { logAudit } from '@/lib/audit'
import { logger } from '@/lib/logger'

// POST /api/financeiro/comprovantes/[id]/descartar — o atendente confere e
// DESCARTA um comprovante do INBOX (não é cobrança, duplicado, etc.). Claim
// ATÔMICO pendente→descartado (quem chegar segundo leva 409). Remove o arquivo
// do bucket (best-effort) mas MANTÉM a linha: ela é o tombstone do dedup do
// webhook — UNIQUE (tenant_id, mensagem_id) impede que uma reentrega do Chatwoot
// recrie o registro. TODA a equipe (admin/advogado/colaborador) — igual às irmãs.

const ROLES = ['admin', 'advogado', 'colaborador']

function adminStorage() {
  return createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  ).storage.from('documentos')
}

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

  // CLAIM ATÔMICO: só descarta quem encontrar o registro ainda pendente.
  const { data: descartados, error } = await supabase
    .from('comprovantes_recebidos')
    .update({ status: 'descartado', resolvido_em: new Date().toISOString(), resolvido_por: usuario.id })
    .eq('id', id)
    .eq('tenant_id', usuario.tenant_id)
    .eq('status', 'pendente')
    .select('id, arquivo_url')
  if (error) return jsonError(error.message, 500)
  if (!descartados || descartados.length === 0) {
    return jsonError('Comprovante já atribuído ou descartado', 409)
  }
  const registro = descartados[0] as { id: string; arquivo_url: string | null }

  // Remove o arquivo do bucket (best-effort): a linha continua como tombstone do
  // dedup; falha aqui não desfaz o descarte (LGPD: só ids).
  if (registro.arquivo_url) {
    const { error: rmErr } = await adminStorage().remove([registro.arquivo_url])
    if (rmErr) logger.warn('financeiro.comprovante_inbox.remove_falhou', { id, tenantId: usuario.tenant_id })
  }

  await logAudit({
    tenantId: usuario.tenant_id,
    userId: usuario.id,
    action: 'financeiro.comprovante_inbox_descartado',
    resourceType: 'comprovante_recebido',
    resourceId: id,
  })

  return NextResponse.json({ ok: true })
}
