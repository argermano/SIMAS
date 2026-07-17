import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getAuthContext, requireRole } from '@/lib/auth'
import { jsonError, validateBody } from '@/lib/api'
import { pertenceAoTenant } from '@/lib/ownership'
import { gerarSerie } from '@/lib/financeiro/parcelas'
import { sincronizarPrevisaoContrato } from '@/lib/financeiro/previsao'
import { hojeSaoPauloISO } from '@/lib/processos/util'

// Financeiro L1 — parcelas (cobranças). Papel: TODA a equipe
// (admin/advogado/colaborador) — decisão do dono. Valores SEMPRE em centavos.

const ROLES = ['admin', 'advogado', 'colaborador']
const DATA_RE = /^\d{4}-\d{2}-\d{2}$/

const COLS =
  'id, cliente_id, contrato_id, processo_id, descricao, valor_centavos, vencimento, ' +
  'status, pago_em, pago_valor_centavos, meio, comprovante_url, created_at, ' +
  // Staging do comprovante recebido por WhatsApp (migration 052) — habilita o
  // estado derivado "aguardando baixa" na tela. A URL aqui é só o path no
  // bucket (a UI pede signed URL sob demanda); jsonb com os dados da IA.
  'comprovante_recebido_em, comprovante_recebido_url, comprovante_recebido_dados'

interface ParcelaRow {
  id: string
  cliente_id: string
  contrato_id: string | null
  processo_id: string | null
  descricao: string
  valor_centavos: number
  vencimento: string
  status: string
  pago_em: string | null
  pago_valor_centavos: number | null
  meio: string | null
  comprovante_url: string | null
  created_at: string
  comprovante_recebido_em: string | null
  comprovante_recebido_url: string | null
  comprovante_recebido_dados: Record<string, unknown> | null
}

// GET /api/financeiro/parcelas — lista com filtros e paginação.
// Filtros: status (aberta|paga|cancelada|vencida — vencida = aberta com
// vencimento < hoje SP), de/ate (vencimento), clienteId, q (busca por nome do
// cliente). Enriquece o nome do cliente em lote.
export async function GET(req: NextRequest) {
  const auth = await getAuthContext()
  if (!auth.ok) return auth.response
  const gate = requireRole(auth.usuario, ROLES)
  if (gate) return gate
  const { supabase, usuario } = auth

  const { searchParams } = new URL(req.url)
  const status = searchParams.get('status')
  const de = searchParams.get('de')
  const ate = searchParams.get('ate')
  const pagoDe = searchParams.get('pagoDe')
  const pagoAte = searchParams.get('pagoAte')
  const clienteId = searchParams.get('clienteId')
  // "aguardando baixa" = parcela aberta com comprovante recebido por WhatsApp
  // ainda não conferido. Filtro server-side para o chip contar o TOTAL do tenant
  // (não só a página) e paginar corretamente ao focar só nesses casos.
  const aguardando = searchParams.get('aguardando') === '1'
  const q = (searchParams.get('q') ?? '').trim()
  const page = Math.max(1, parseInt(searchParams.get('page') ?? '1') || 1)
  const limit = Math.min(100, Math.max(1, parseInt(searchParams.get('limit') ?? '20') || 20))
  const offset = (page - 1) * limit

  if (
    (de && !DATA_RE.test(de)) || (ate && !DATA_RE.test(ate)) ||
    (pagoDe && !DATA_RE.test(pagoDe)) || (pagoAte && !DATA_RE.test(pagoAte))
  ) {
    return jsonError('Período inválido (esperado yyyy-mm-dd)', 400)
  }

  // Busca por nome do cliente: resolve os ids antes (lote) e filtra por IN.
  let idsPorNome: string[] | null = null
  if (q) {
    const { data: achados, error } = await supabase
      .from('clientes')
      .select('id')
      .eq('tenant_id', usuario.tenant_id)
      .is('deleted_at', null)
      .ilike('nome', `%${q.replace(/[%_]/g, '')}%`)
      .limit(200)
    if (error) return jsonError(error.message, 500)
    idsPorNome = (achados ?? []).map((c) => c.id)
    if (idsPorNome.length === 0) {
      return NextResponse.json({ parcelas: [], total: 0, pagina: page, totalPaginas: 0 })
    }
  }

  let query = supabase
    .from('parcelas')
    .select(COLS, { count: 'exact' })
    .eq('tenant_id', usuario.tenant_id)
    .order('vencimento', { ascending: true })
    .order('created_at', { ascending: true })
    .range(offset, offset + limit - 1)

  if (aguardando) {
    // Sobrepõe o status: aguardando baixa é sempre aberta + comprovante recebido.
    query = query.eq('status', 'aberta').not('comprovante_recebido_em', 'is', null)
  } else if (status === 'vencida') {
    query = query.eq('status', 'aberta').lt('vencimento', hojeSaoPauloISO())
  } else if (status) {
    if (!['aberta', 'paga', 'cancelada', 'prevista'].includes(status)) return jsonError('Status inválido', 400)
    query = query.eq('status', status)
  }
  if (de) query = query.gte('vencimento', de)
  if (ate) query = query.lte('vencimento', ate)
  // Filtro por DATA DO PAGAMENTO (pago_em, timestamptz) — limites do dia em
  // America/Sao_Paulo (-03:00, sem DST no BR). Usado pelo indicador
  // "Recebido no mês", que soma por pago_em (não por vencimento).
  if (pagoDe) query = query.gte('pago_em', `${pagoDe}T00:00:00-03:00`)
  if (pagoAte) query = query.lte('pago_em', `${pagoAte}T23:59:59.999-03:00`)
  if (clienteId) query = query.eq('cliente_id', clienteId)
  if (idsPorNome) query = query.in('cliente_id', idsPorNome)

  const { data, error, count } = await query
  if (error) return jsonError(error.message, 500)

  // Enriquece o nome do cliente em lote (uma query só).
  const linhas = (data ?? []) as unknown as ParcelaRow[]
  const clienteIds = [...new Set(linhas.map((p) => p.cliente_id))]
  const nomes = new Map<string, string | null>()
  if (clienteIds.length > 0) {
    const { data: clientes } = await supabase
      .from('clientes')
      .select('id, nome')
      .eq('tenant_id', usuario.tenant_id)
      .in('id', clienteIds)
    for (const c of clientes ?? []) nomes.set(c.id, c.nome)
  }

  return NextResponse.json({
    parcelas: linhas.map((p) => ({ ...p, cliente_nome: nomes.get(p.cliente_id) ?? null })),
    total: count ?? 0,
    pagina: page,
    totalPaginas: Math.ceil((count ?? 0) / limit),
  })
}

const avulsaSchema = z.object({
  descricao: z.string().trim().min(1).max(300),
  valorCentavos: z.number().int().positive(),
  vencimento: z.string().regex(DATA_RE),
})

const serieSchema = z.object({
  valorTotalCentavos: z.number().int().positive(),
  entradaCentavos: z.number().int().min(0).optional(),
  numParcelas: z.number().int().min(1).max(120),
  primeiroVencimento: z.string().regex(DATA_RE),
  diaFixo: z.number().int().min(1).max(31).optional(),
})

const criarSchema = z
  .object({
    clienteId: z.string().uuid(),
    contratoId: z.string().uuid().nullish(),
    processoId: z.string().uuid().nullish(),
    avulsa: avulsaSchema.optional(),
    serie: serieSchema.optional(),
  })
  .refine((d) => !!d.avulsa !== !!d.serie, { message: 'Informe "avulsa" OU "serie" (exatamente um)' })

// POST /api/financeiro/parcelas — cria cobrança avulsa OU série (gerarSerie:
// entrada opcional + N parcelas, resto na última — soma exata).
export async function POST(req: NextRequest) {
  const auth = await getAuthContext()
  if (!auth.ok) return auth.response
  const gate = requireRole(auth.usuario, ROLES)
  if (gate) return gate
  const { supabase, usuario } = auth

  const parsed = await validateBody(req, criarSchema)
  if (!parsed.ok) return parsed.response
  const dados = parsed.data

  // A8: FKs vindas do corpo precisam pertencer ao tenant.
  if (!(await pertenceAoTenant(supabase, 'clientes', dados.clienteId, usuario.tenant_id))) {
    return jsonError('Cliente inválido', 400)
  }
  if (dados.contratoId && !(await pertenceAoTenant(supabase, 'contratos_honorarios', dados.contratoId, usuario.tenant_id))) {
    return jsonError('Contrato inválido', 400)
  }
  if (dados.processoId) {
    const { data: proc } = await supabase
      .from('processos')
      .select('id')
      .eq('id', dados.processoId)
      .eq('tenant_id', usuario.tenant_id)
      .maybeSingle()
    if (!proc) return jsonError('Processo inválido', 400)
  }

  let itens: { descricao: string; valor_centavos: number; vencimento: string }[]
  if (dados.avulsa) {
    itens = [{
      descricao: dados.avulsa.descricao,
      valor_centavos: dados.avulsa.valorCentavos,
      vencimento: dados.avulsa.vencimento,
    }]
  } else {
    try {
      itens = gerarSerie(dados.serie!)
    } catch (err) {
      return jsonError(err instanceof Error ? err.message : 'Série inválida', 400)
    }
  }

  const { data: criadas, error } = await supabase
    .from('parcelas')
    .insert(itens.map((i) => ({
      tenant_id: usuario.tenant_id,
      cliente_id: dados.clienteId,
      contrato_id: dados.contratoId ?? null,
      processo_id: dados.processoId ?? null,
      descricao: i.descricao,
      valor_centavos: i.valor_centavos,
      vencimento: i.vencimento,
      created_by: usuario.id,
    })))
    .select(COLS)
  if (error) return jsonError(error.message, 500)

  // Nasceu a série real do contrato → a previsão de recebimento deixa de fazer
  // sentido (a estimativa foi substituída pelas parcelas de verdade). Remove-a.
  if (dados.contratoId) {
    await sincronizarPrevisaoContrato(supabase, dados.contratoId)
  }

  return NextResponse.json({ parcelas: criadas ?? [] }, { status: 201 })
}
