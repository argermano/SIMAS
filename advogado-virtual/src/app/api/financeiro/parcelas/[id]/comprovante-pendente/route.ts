import { NextRequest, NextResponse } from 'next/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { getAuthContext, requireRole } from '@/lib/auth'
import { jsonError } from '@/lib/api'
import { logAudit } from '@/lib/audit'
import { logger } from '@/lib/logger'

// Comprovante recebido por WhatsApp e pré-organizado pelo staging (migration
// 052): o cliente manda a imagem/PDF, o SIMAS extrai os dados com IA e grava um
// "comprovante pendente" na parcela aberta que casou. Esta rota serve a tela de
// conferência (/financeiro): mostra o arquivo + dados extraídos, ou descarta.
// INVARIANTE DURA: a baixa NUNCA é automática — quem confirma é POST /baixa.
// TODA a equipe (admin/advogado/colaborador) pode conferir — decisão do dono.

const ROLES = ['admin', 'advogado', 'colaborador']

// Bucket privado — a UI só vê o arquivo via signed URL de curta duração.
function adminStorage() {
  return createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  ).storage.from('documentos')
}

// GET — parcela do tenant com comprovante pendente (404 se não houver).
// Devolve os dados extraídos, uma signed URL de 10 min do arquivo e o
// contentType (para a UI decidir entre <img> e link de PDF).
export async function GET(
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
    .select('id, comprovante_recebido_em, comprovante_recebido_url, comprovante_recebido_dados')
    .eq('id', id)
    .eq('tenant_id', usuario.tenant_id)
    .maybeSingle()
  if (!parcela || !parcela.comprovante_recebido_em) {
    return jsonError('Nenhum comprovante pendente para esta parcela', 404)
  }

  const dados = (parcela.comprovante_recebido_dados ?? {}) as Record<string, unknown>
  const contentType = typeof dados.contentType === 'string' ? dados.contentType : null

  // Signed URLs de 10 min (o arquivo mora em bucket privado por tenant): uma
  // inline (img/nova aba) e outra que força download (Content-Disposition
  // attachment via opção { download } do supabase-js v2).
  let imagemUrl: string | null = null
  let downloadUrl: string | null = null
  if (parcela.comprovante_recebido_url) {
    const store = adminStorage()
    const ext = (parcela.comprovante_recebido_url.split('.').pop() ?? 'dat').toLowerCase()
    const dataArq = (parcela.comprovante_recebido_em ?? '').slice(0, 10) || 'comprovante'
    const [inline, download] = await Promise.all([
      store.createSignedUrl(parcela.comprovante_recebido_url, 600),
      store.createSignedUrl(parcela.comprovante_recebido_url, 600, { download: `comprovante-${dataArq}.${ext}` }),
    ])
    if (inline.error || download.error) {
      logger.error('financeiro.comprovante_pendente.signed_url', { parcelaId: id, tenantId: usuario.tenant_id })
    }
    imagemUrl = inline.data?.signedUrl ?? null
    downloadUrl = download.data?.signedUrl ?? null
  }

  return NextResponse.json({ dados, imagemUrl, downloadUrl, contentType })
}

// DELETE — "não é comprovante": limpa o staging, remove o arquivo do bucket
// (best-effort) e audita. Não mexe no status da parcela.
export async function DELETE(
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
    .select('id, status, comprovante_recebido_em, comprovante_recebido_url, comprovante_recebido_dados')
    .eq('id', id)
    .eq('tenant_id', usuario.tenant_id)
    .maybeSingle()
  if (!parcela) return jsonError('Parcela não encontrada', 404)
  // Só descarta um staging que AINDA está aguardando: não pode mexer numa
  // parcela já baixada que adotou o arquivo staged como comprovante OFICIAL
  // (senão o remove abaixo apagaria o comprovante da parcela paga).
  if (parcela.status !== 'aberta' || !parcela.comprovante_recebido_em) {
    return jsonError('Nenhum comprovante pendente para esta parcela', 409)
  }

  // Mantém o mensagemId como TOMBSTONE (única chave de dedup do webhook): sem
  // ele, uma reentrega do Chatwoot recriaria o pendente que o humano descartou.
  const dadosStg = (parcela.comprovante_recebido_dados ?? {}) as Record<string, unknown>
  const mensagemId = typeof dadosStg.mensagemId === 'string' ? dadosStg.mensagemId : null

  // Claim atômico gateado pelo estado "aguardando": se uma baixa/cancelamento
  // consumiu o staging entre o SELECT e aqui, este UPDATE não atinge linha
  // nenhuma e NÃO removemos o arquivo (que virou o comprovante oficial).
  const { data: limpas, error } = await supabase
    .from('parcelas')
    .update({
      comprovante_recebido_em: null,
      comprovante_recebido_url: null,
      comprovante_recebido_dados: mensagemId ? { mensagemId } : null,
    })
    .eq('id', id)
    .eq('tenant_id', usuario.tenant_id)
    .eq('status', 'aberta')
    .not('comprovante_recebido_em', 'is', null)
    .select('id')
  if (error) return jsonError(error.message, 500)
  if (!limpas || limpas.length === 0) {
    return jsonError('Nenhum comprovante pendente para esta parcela', 409)
  }

  // Remove o arquivo órfão (best-effort — falha aqui não bloqueia o descarte).
  // Seguro: o claim gateado acima garante que este recebido_url era nosso.
  if (parcela.comprovante_recebido_url) {
    const { error: rmErr } = await adminStorage().remove([parcela.comprovante_recebido_url])
    if (rmErr) {
      logger.error('financeiro.comprovante_descartado.remove', { parcelaId: id, tenantId: usuario.tenant_id })
    }
  }

  await logAudit({
    tenantId: usuario.tenant_id,
    userId: usuario.id,
    action: 'financeiro.comprovante_descartado',
    resourceType: 'parcela',
    resourceId: id,
  })

  return NextResponse.json({ ok: true })
}
