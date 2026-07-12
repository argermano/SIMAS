import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { getAuthContext, requireRole } from '@/lib/auth'
import { jsonError, validateBody } from '@/lib/api'
import { logAudit } from '@/lib/audit'
import { logger } from '@/lib/logger'
import { dadosComprovanteSchema } from '@/lib/financeiro/comprovante'

// POST /api/financeiro/parcelas/[id]/baixa — confirma o recebimento.
// INVARIANTE DURA: baixa NUNCA é automática — esta rota só roda por clique
// humano de confirmação (a IA apenas sugere). Claim ATÔMICO no WHERE
// status='aberta' (padrão Fase 5): sob concorrência, só um vence.
// TODA a equipe (admin/advogado/colaborador) pode dar baixa — decisão do dono.

const ROLES = ['admin', 'advogado', 'colaborador']

const EXTENSOES: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'application/pdf': 'pdf',
}
const MAX_COMPROVANTE_BASE64 = 14 * 1024 * 1024 // ~10 MB binários

const schema = z
  .object({
    meio: z.enum(['pix', 'boleto', 'transferencia', 'dinheiro', 'outro']),
    pagoEm: z.string().optional(),          // ISO (data ou data+hora); default agora
    valorPago: z.number().int().positive().optional(), // centavos; default valor da parcela
    obs: z.string().trim().max(1000).optional(),
    comprovanteUrl: z.string().max(500).optional(),    // path já existente no storage
    comprovanteDados: dadosComprovanteSchema.optional(),
    comprovanteBase64: z.string().max(MAX_COMPROVANTE_BASE64).optional(),
    contentType: z.string().optional(),
  })
  .refine((d) => !d.comprovanteBase64 || !!EXTENSOES[d.contentType ?? ''], {
    message: 'contentType do comprovante inválido (jpeg, png, webp, gif ou pdf)',
  })

function adminStorage() {
  return createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  ).storage.from('documentos')
}

// Remove os arquivos de staging pendentes de UMA parcela (pendentes/<id>-*),
// preservando `manter` (o comprovante que virou oficial, se houver). Escopo
// estrito ao id da parcela — nunca toca staging de outra. Best-effort: nunca
// lança; qualquer falha só loga (LGPD: apenas ids).
async function limparPendentesDaParcela(tenantId: string, parcelaId: string, manter: string | null) {
  try {
    const store = adminStorage()
    const { data: sobras } = await store.list(`financeiro/${tenantId}/pendentes`, {
      search: `${parcelaId}-`,
      limit: 100,
    })
    const remover = (sobras ?? [])
      .map((f) => `financeiro/${tenantId}/pendentes/${f.name}`)
      .filter((p) => p !== manter)
    if (remover.length > 0) {
      const { error: rmErr } = await store.remove(remover)
      if (rmErr) logger.warn('financeiro.pendentes.sweep_falhou', { parcelaId, tenantId })
    }
  } catch {
    logger.warn('financeiro.pendentes.sweep_falhou', { parcelaId, tenantId })
  }
}

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

  const parsed = await validateBody(req, schema)
  if (!parsed.ok) return parsed.response
  const dados = parsed.data

  // Data pura (yyyy-mm-dd) é interpretada no fuso do escritório (America/
  // Sao_Paulo, -03:00): new Date('2026-08-01') seria meia-noite UTC = 31/07
  // 21:00 em SP e o "Recebido no mês" somaria no mês ANTERIOR.
  const pagoEm = dados.pagoEm
    ? /^\d{4}-\d{2}-\d{2}$/.test(dados.pagoEm)
      ? new Date(`${dados.pagoEm}T12:00:00-03:00`)
      : new Date(dados.pagoEm)
    : new Date()
  if (Number.isNaN(pagoEm.getTime())) return jsonError('Data de pagamento inválida', 400)

  const { data: parcela } = await supabase
    .from('parcelas')
    .select('id, status, valor_centavos, cliente_id, comprovante_recebido_url, comprovante_recebido_dados')
    .eq('id', id)
    .eq('tenant_id', usuario.tenant_id)
    .maybeSingle()
  if (!parcela) return jsonError('Parcela não encontrada', 404)
  if (parcela.status !== 'aberta') {
    return jsonError('Parcela já baixada ou cancelada', 409)
  }

  // comprovanteUrl vinda do corpo só pode apontar para o espaço do PRÓPRIO
  // tenant no bucket (evita registrar path de outro escritório — leitura
  // cross-tenant latente quando o L2 assinar URLs a partir da coluna).
  if (dados.comprovanteUrl && !dados.comprovanteUrl.startsWith(`financeiro/${usuario.tenant_id}/`)) {
    return jsonError('comprovanteUrl inválida (fora do espaço do escritório)', 400)
  }

  // Comprovante: grava no bucket ANTES do claim (path determinístico por
  // parcela — se o claim perder a corrida, o arquivo fica órfão inofensivo).
  let comprovanteUrl = dados.comprovanteUrl ?? null
  let comprovanteDados = dados.comprovanteDados ?? null
  if (dados.comprovanteBase64) {
    const ext = EXTENSOES[dados.contentType!]
    let buffer: Buffer
    try {
      buffer = Buffer.from(dados.comprovanteBase64, 'base64')
    } catch {
      return jsonError('Comprovante inválido (base64 malformado)', 400)
    }
    if (buffer.length === 0) return jsonError('Comprovante vazio', 400)
    const path = `financeiro/${usuario.tenant_id}/${id}.${ext}`
    const { error: upErr } = await adminStorage().upload(path, buffer, {
      contentType: dados.contentType!,
      upsert: true,
    })
    if (upErr) {
      logger.error('financeiro.baixa.upload_comprovante', { parcelaId: id, tenantId: usuario.tenant_id })
      return jsonError('Erro ao salvar o comprovante', 500)
    }
    comprovanteUrl = path
  }

  // Se a baixa NÃO trouxe comprovante próprio mas a parcela já tinha um em
  // staging (o cliente enviou pelo WhatsApp e ficou "aguardando baixa"),
  // aproveita o staged como comprovante DEFINITIVO — o humano está confirmando
  // justamente aquele. Nesse caso o arquivo em pendentes/ NÃO é removido
  // (vira o oficial); só as colunas de staging são limpas no UPDATE.
  const stagedUrl = (parcela.comprovante_recebido_url as string | null) ?? null
  if (!comprovanteUrl && stagedUrl) {
    comprovanteUrl = stagedUrl
    comprovanteDados = comprovanteDados ?? parcela.comprovante_recebido_dados ?? null
  }

  // mensagemId do staging vira TOMBSTONE de dedup (sobrevive à baixa): sem ele,
  // uma reentrega do webhook re-stagearia o MESMO pagamento em outra parcela
  // aberta, induzindo o operador a dar baixa duas vezes.
  const stgDados = (parcela.comprovante_recebido_dados ?? {}) as Record<string, unknown>
  const stagedMensagemId = typeof stgDados.mensagemId === 'string' ? stgDados.mensagemId : null

  // CLAIM ATÔMICO: só baixa quem encontrar a parcela ainda aberta.
  const { data: baixadas, error } = await supabase
    .from('parcelas')
    .update({
      status: 'paga',
      pago_em: pagoEm.toISOString(),
      pago_valor_centavos: dados.valorPago ?? parcela.valor_centavos,
      meio: dados.meio,
      comprovante_url: comprovanteUrl,
      comprovante_dados: comprovanteDados,
      baixa_por: usuario.id,
      baixa_obs: dados.obs ?? null,
      // A baixa consome o staging: some o estado "aguardando baixa" mesmo que a
      // confirmação tenha vindo por outro caminho/arquivo (não faz sentido
      // manter pendência de conferência depois de já baixada). Mantém só o
      // mensagemId como tombstone de dedup (ver stagedMensagemId).
      comprovante_recebido_em: null,
      comprovante_recebido_url: null,
      comprovante_recebido_dados: stagedMensagemId ? { mensagemId: stagedMensagemId } : null,
    })
    .eq('id', id)
    .eq('tenant_id', usuario.tenant_id)
    .eq('status', 'aberta')
    .select('id, cliente_id, descricao, valor_centavos, vencimento, status, pago_em, pago_valor_centavos, meio, comprovante_url')
  if (error) return jsonError(error.message, 500)
  if (!baixadas || baixadas.length === 0) {
    return jsonError('Parcela já baixada ou cancelada', 409)
  }

  // Best-effort: varre os arquivos órfãos em pendentes/<parcelaId>-* e remove
  // TODOS os que não viraram o comprovante oficial desta baixa. Cobre não só o
  // staged lido no SELECT, mas também um re-staging concorrente do webhook na
  // janela SELECT→UPDATE (cujo path — outro mensagemId — o SELECT não conhecia)
  // e sobras de entregas duplicadas. Falha aqui não afeta a baixa (LGPD: ids).
  await limparPendentesDaParcela(usuario.tenant_id, id, comprovanteUrl)

  await logAudit({
    tenantId: usuario.tenant_id,
    userId: usuario.id,
    action: 'financeiro.baixa',
    resourceType: 'parcela',
    resourceId: id,
    metadata: { meio: dados.meio, comComprovante: !!comprovanteUrl, stagedAdotado: !!(stagedUrl && stagedUrl === comprovanteUrl) },
  })

  return NextResponse.json({ parcela: baixadas[0] })
}
