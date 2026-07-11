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
    .select('id, status, valor_centavos, cliente_id')
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

  // CLAIM ATÔMICO: só baixa quem encontrar a parcela ainda aberta.
  const { data: baixadas, error } = await supabase
    .from('parcelas')
    .update({
      status: 'paga',
      pago_em: pagoEm.toISOString(),
      pago_valor_centavos: dados.valorPago ?? parcela.valor_centavos,
      meio: dados.meio,
      comprovante_url: comprovanteUrl,
      comprovante_dados: dados.comprovanteDados ?? null,
      baixa_por: usuario.id,
      baixa_obs: dados.obs ?? null,
    })
    .eq('id', id)
    .eq('tenant_id', usuario.tenant_id)
    .eq('status', 'aberta')
    .select('id, cliente_id, descricao, valor_centavos, vencimento, status, pago_em, pago_valor_centavos, meio, comprovante_url')
  if (error) return jsonError(error.message, 500)
  if (!baixadas || baixadas.length === 0) {
    return jsonError('Parcela já baixada ou cancelada', 409)
  }

  await logAudit({
    tenantId: usuario.tenant_id,
    userId: usuario.id,
    action: 'financeiro.baixa',
    resourceType: 'parcela',
    resourceId: id,
    metadata: { meio: dados.meio, comComprovante: !!comprovanteUrl },
  })

  return NextResponse.json({ parcela: baixadas[0] })
}
