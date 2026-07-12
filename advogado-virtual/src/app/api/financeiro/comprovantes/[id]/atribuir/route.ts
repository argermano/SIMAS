import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { getAuthContext, requireRole, type Usuario } from '@/lib/auth'
import { jsonError, validateBody } from '@/lib/api'
import { logAudit } from '@/lib/audit'
import { logger } from '@/lib/logger'
import { pertenceAoTenant } from '@/lib/ownership'
import type { createClient } from '@/lib/supabase/server'

// POST /api/financeiro/comprovantes/[id]/atribuir — o atendente confere um
// comprovante do INBOX e o ATRIBUI a uma cobrança. Esse clique É a confirmação
// humana (a invariante "baixa só com confirmação humana" segue respeitada):
//   - parcelaId  → dá baixa numa parcela EXISTENTE (aberta, do cliente/tenant);
//   - novaCobranca → CRIA a parcela (aberta) e dá baixa imediata.
// Claim ATÔMICO do registro (pendente→atribuido): quem chegar segundo leva 409.
// Se a baixa falhar depois do claim, faz ROLLBACK do registro (volta a pendente).
// Semântica da baixa idêntica à rota .../parcelas/[id]/baixa (claim atômico,
// pago_em -03:00, comprovante do registro, limpeza de staging, logAudit).
// TODA a equipe (admin/advogado/colaborador) — igual às rotas irmãs.

const ROLES = ['admin', 'advogado', 'colaborador']
const DATA_RE = /^\d{4}-\d{2}-\d{2}$/

type SupabaseServer = Awaited<ReturnType<typeof createClient>>

const novaCobrancaSchema = z.object({
  descricao: z.string().trim().min(1).max(200),
  valorCentavos: z.number().int().positive(),
  vencimento: z.string().regex(DATA_RE),
  contratoId: z.string().uuid().optional(),
})

const schema = z
  .object({
    clienteId: z.string().uuid(),
    meio: z.enum(['pix', 'transferencia', 'boleto', 'dinheiro', 'outro']).default('pix'),
    parcelaId: z.string().uuid().optional(),
    novaCobranca: novaCobrancaSchema.optional(),
  })
  // XOR: exatamente um caminho (baixar existente OU criar+baixar nova).
  .refine((d) => !!d.parcelaId !== !!d.novaCobranca, {
    message: 'Informe "parcelaId" OU "novaCobranca" (exatamente um)',
  })

function adminStorage() {
  return createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  ).storage.from('documentos')
}

// Remove os arquivos de staging pendentes de UMA parcela (pendentes/<id>-*),
// preservando `manter` (o que virou oficial). Cópia fiel da rota de baixa —
// best-effort, nunca lança (LGPD: só ids).
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

interface ParcelaAlvo {
  id: string
  valor_centavos: number
  comprovante_recebido_dados: Record<string, unknown> | null
}

// Baixa ATÔMICA (WHERE status='aberta') usando o comprovante do inbox. Devolve a
// linha baixada ou null se a corrida foi perdida (parcela saiu de 'aberta').
// Mesma semântica da rota manual: pago_em -03:00, staging limpo mantendo o
// mensagemId como tombstone de dedup.
async function darBaixa(
  db: SupabaseServer,
  usuario: Usuario,
  parcela: ParcelaAlvo,
  opts: { meio: string; pagoEm: Date; comprovanteUrl: string; comprovanteDados: unknown; valorPagoCentavos: number | null },
) {
  const stg = (parcela.comprovante_recebido_dados ?? {}) as Record<string, unknown>
  const tombstone = typeof stg.mensagemId === 'string' ? { mensagemId: stg.mensagemId } : null

  const { data: baixadas, error } = await db
    .from('parcelas')
    .update({
      status: 'paga',
      pago_em: opts.pagoEm.toISOString(),
      // Valor REALMENTE recebido (do comprovante) quando informado; senão o
      // nominal. Paridade com a rota manual (valorPago ?? valor_centavos).
      pago_valor_centavos: opts.valorPagoCentavos ?? parcela.valor_centavos,
      meio: opts.meio,
      comprovante_url: opts.comprovanteUrl,
      comprovante_dados: opts.comprovanteDados,
      baixa_por: usuario.id,
      // A baixa consome qualquer staging da parcela — mantém só o mensagemId
      // como tombstone de dedup do webhook (paridade com a rota manual).
      comprovante_recebido_em: null,
      comprovante_recebido_url: null,
      comprovante_recebido_dados: tombstone,
    })
    .eq('id', parcela.id)
    .eq('tenant_id', usuario.tenant_id)
    .eq('status', 'aberta')
    .select(
      'id, cliente_id, descricao, valor_centavos, vencimento, status, pago_em, pago_valor_centavos, meio, comprovante_url',
    )
  if (error) return { error }
  return { row: baixadas && baixadas.length > 0 ? baixadas[0] : null }
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

  // FKs do corpo precisam pertencer ao tenant (A8). O cliente é obrigatório.
  if (!(await pertenceAoTenant(supabase, 'clientes', dados.clienteId, usuario.tenant_id))) {
    return jsonError('Cliente inválido', 400)
  }

  // Pré-valida o ALVO antes de reivindicar o registro (evita claim/rollback à
  // toa). A baixa real ainda é atômica (WHERE status='aberta') mais abaixo.
  let parcelaExistente: ParcelaAlvo | null = null
  if (dados.parcelaId) {
    const { data: p } = await supabase
      .from('parcelas')
      .select('id, status, valor_centavos, comprovante_recebido_dados')
      .eq('id', dados.parcelaId)
      .eq('tenant_id', usuario.tenant_id)
      .eq('cliente_id', dados.clienteId)
      .maybeSingle()
    if (!p) return jsonError('Parcela não encontrada', 404)
    if (p.status !== 'aberta') return jsonError('Parcela já baixada ou cancelada', 409)
    parcelaExistente = {
      id: p.id as string,
      valor_centavos: p.valor_centavos as number,
      comprovante_recebido_dados: p.comprovante_recebido_dados as Record<string, unknown> | null,
    }
  } else if (dados.novaCobranca?.contratoId) {
    // Contrato precisa ser do tenant E do cliente informado.
    const { data: contrato } = await supabase
      .from('contratos_honorarios')
      .select('id')
      .eq('id', dados.novaCobranca.contratoId)
      .eq('tenant_id', usuario.tenant_id)
      .eq('cliente_id', dados.clienteId)
      .maybeSingle()
    if (!contrato) return jsonError('Contrato inválido', 400)
  }

  // CLAIM ATÔMICO do registro do inbox (pendente→atribuido). Quem perder a
  // corrida (segundo atendente) recebe 409. RETURNING traz o comprovante.
  const { data: reclamados, error: erroClaim } = await supabase
    .from('comprovantes_recebidos')
    .update({ status: 'atribuido' })
    .eq('id', id)
    .eq('tenant_id', usuario.tenant_id)
    .eq('status', 'pendente')
    .select('id, arquivo_url, dados')
  if (erroClaim) return jsonError(erroClaim.message, 500)
  if (!reclamados || reclamados.length === 0) {
    return jsonError('Comprovante já atribuído ou descartado', 409)
  }
  const registro = reclamados[0] as { id: string; arquivo_url: string; dados: Record<string, unknown> | null }

  // Rollback do claim: volta a pendente para o atendente tentar de novo quando a
  // baixa não conclui. Como NÃO há transação envolvendo o INSERT da cobrança nova
  // + a baixa, o rollback também precisa REMOVER a parcela recém-criada — senão
  // ela fica ABERTA órfã e o reprocessamento do comprovante a duplicaria. Só
  // apaga se ainda ABERTA (nunca uma que já tenha sido baixada). Se o rollback do
  // registro FALHAR, ele fica preso em 'atribuido' (some do inbox, que só lista
  // 'pendente'): loga p/ recuperação manual em vez de perder o comprovante em
  // silêncio.
  let parcelaCriadaId: string | null = null
  const rollback = async () => {
    if (parcelaCriadaId) {
      const { error: delErr } = await supabase
        .from('parcelas')
        .delete()
        .eq('id', parcelaCriadaId)
        .eq('tenant_id', usuario.tenant_id)
        .eq('status', 'aberta')
      if (delErr) {
        logger.error('financeiro.comprovante_inbox.rollback_parcela_falhou', { id, tenantId: usuario.tenant_id })
      }
    }
    const { error: rbErr } = await supabase
      .from('comprovantes_recebidos')
      .update({ status: 'pendente' })
      .eq('id', id)
      .eq('tenant_id', usuario.tenant_id)
      .eq('status', 'atribuido')
    if (rbErr) {
      logger.error('financeiro.comprovante_inbox.rollback_falhou', { id, tenantId: usuario.tenant_id })
    }
  }

  // comprovante_url só pode apontar para o espaço do PRÓPRIO tenant no bucket
  // (o arquivo do inbox é financeiro/<tenant>/inbox/... — valida por prefixo).
  const comprovanteUrl = registro.arquivo_url
  if (!comprovanteUrl || !comprovanteUrl.startsWith(`financeiro/${usuario.tenant_id}/`)) {
    await rollback()
    logger.error('financeiro.comprovante_inbox.url_invalida', { id, tenantId: usuario.tenant_id })
    return jsonError('Comprovante inválido (fora do espaço do escritório)', 500)
  }

  // pago_em = data do pagamento extraída pela IA (dataISO), interpretada em SP
  // (-03:00, meio-dia p/ não vazar de mês); sem data válida, cai em agora.
  const rawDados = (registro.dados ?? {}) as Record<string, unknown>
  const dataISO =
    typeof rawDados.dataISO === 'string' && DATA_RE.test(rawDados.dataISO) ? rawDados.dataISO : null
  // dataISO pode passar no regex e ainda ser calendário inválido (mês 00/13…):
  // aí new Date(...) vira Invalid Date e toISOString() lançaria RangeError na
  // baixa (500 SEM rollback → registro preso + cobrança órfã). Sem data VÁLIDA
  // cai em agora — paridade com o guard Number.isNaN(getTime()) da baixa manual.
  const dataCandidata = dataISO ? new Date(`${dataISO}T12:00:00-03:00`) : new Date()
  const pagoEm = Number.isNaN(dataCandidata.getTime()) ? new Date() : dataCandidata

  // Valor REALMENTE recebido = o do comprovante (extração da IA). Um comprovante
  // só cai no inbox COM parcela aberta quando NENHUMA casou em ±1% (caso b), logo
  // o nominal é comprovadamente ≠: usá-lo inflaria o "recebido no mês". Ao baixar
  // uma parcela EXISTENTE usamos o valor extraído; na cobrança NOVA o nominal já
  // é o valor que o atendente informou (mantém nominal via null).
  const valorExtraido =
    typeof rawDados.valorCentavos === 'number' && Number.isInteger(rawDados.valorCentavos) && rawDados.valorCentavos > 0
      ? rawDados.valorCentavos
      : null

  // Resolve a parcela alvo: existente (pré-validada) ou nova (INSERT aberta).
  let parcela: ParcelaAlvo
  if (parcelaExistente) {
    parcela = parcelaExistente
  } else {
    const nova = dados.novaCobranca!
    const { data: criada, error: insErr } = await supabase
      .from('parcelas')
      .insert({
        tenant_id: usuario.tenant_id,
        cliente_id: dados.clienteId,
        contrato_id: nova.contratoId ?? null,
        descricao: nova.descricao,
        valor_centavos: nova.valorCentavos,
        vencimento: nova.vencimento,
        created_by: usuario.id,
      })
      .select('id, valor_centavos')
      .single()
    if (insErr || !criada) {
      await rollback()
      logger.error('financeiro.comprovante_inbox.insert_parcela', { id, tenantId: usuario.tenant_id })
      return jsonError('Erro ao criar a cobrança', 500)
    }
    parcela = { id: criada.id as string, valor_centavos: criada.valor_centavos as number, comprovante_recebido_dados: null }
    // Marca a cobrança criada NESTA tentativa: se a baixa falhar, o rollback a remove.
    parcelaCriadaId = parcela.id
  }

  // BAIXA ATÔMICA com o comprovante do inbox.
  const baixa = await darBaixa(supabase, usuario, parcela, {
    meio: dados.meio,
    pagoEm,
    comprovanteUrl,
    comprovanteDados: registro.dados,
    // Parcela EXISTENTE: grava o valor do comprovante (evita inflar o recebido).
    // Cobrança NOVA: null → usa o nominal, que é o valor informado pelo atendente.
    valorPagoCentavos: parcelaExistente ? valorExtraido : null,
  })
  if ('error' in baixa && baixa.error) {
    await rollback()
    return jsonError(baixa.error.message, 500)
  }
  if (!('row' in baixa) || !baixa.row) {
    // Parcela saiu de 'aberta' entre a pré-checagem e a baixa (corrida). Volta o
    // registro a pendente para o atendente reavaliar.
    await rollback()
    return jsonError('Parcela já baixada ou cancelada', 409)
  }

  // Varre staging órfão da parcela (paridade com a rota manual) — best-effort.
  await limparPendentesDaParcela(usuario.tenant_id, parcela.id, comprovanteUrl)

  // Fecha o registro do inbox (parcela_id + quem/quando resolveu). O status já
  // está 'atribuido' pelo claim; falha aqui não desfaz a baixa (só loga).
  const { error: fecharErr } = await supabase
    .from('comprovantes_recebidos')
    .update({ parcela_id: parcela.id, resolvido_em: new Date().toISOString(), resolvido_por: usuario.id })
    .eq('id', id)
    .eq('tenant_id', usuario.tenant_id)
  if (fecharErr) {
    logger.warn('financeiro.comprovante_inbox.fechar_falhou', { id, tenantId: usuario.tenant_id })
  }

  await logAudit({
    tenantId: usuario.tenant_id,
    userId: usuario.id,
    action: 'financeiro.comprovante_inbox_atribuido',
    resourceType: 'comprovante_recebido',
    resourceId: id,
    // LGPD: só ids/flags — nunca valores/nomes.
    metadata: { parcelaId: parcela.id, meio: dados.meio, novaCobranca: !parcelaExistente },
  })

  return NextResponse.json({ parcela: baixa.row })
}
