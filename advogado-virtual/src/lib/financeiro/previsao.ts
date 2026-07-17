// Financeiro — previsão de recebimento do contrato (migration 065).
// Ao gerar/editar/assinar um contrato com valor fixo, garantimos UMA parcela
// status 'prevista' (uma estimativa) até que a série real de parcelas exista.
// A previsão NÃO é cobrança: nunca recebe aviso nem baixa (as rotas/o cron
// filtram status='aberta'); assim que houver parcela real do contrato ela é
// REMOVIDA (substituição da estimativa, não baixa). Valores em CENTAVOS.
//
// A lógica de decisão é PURA (decidirPrevisao) e testável sem rede; o wrapper
// sincronizarPrevisaoContrato faz a IO (carrega o estado, dedup, aplica). O
// wrapper é BEST-EFFORT: nunca lança — logger só com ids (LGPD: sem valores).

import type { SupabaseClient } from '@supabase/supabase-js'
import { logger } from '@/lib/logger'

type Db = SupabaseClient

// Dias de estimativa do vencimento da previsão (só na criação — não é reajustado
// a cada sync para não empurrar a data indefinidamente).
const DIAS_ESTIMATIVA = 30

/** Contrato considerado "cancelado/inativo" (defensivo — enum atual não tem esse status). */
const STATUS_CONTRATO_INATIVO = new Set(['cancelado', 'cancelada', 'excluido'])

export interface ContratoPrevisao {
  valor_fixo: number | null
  cliente_id: string | null
  status: string | null
  deleted_at: string | null
  titulo: string | null
  forma_pagamento: string | null
}

export interface PrevisaoExistente {
  id: string
  valor_centavos: number
  descricao: string
}

export interface EstadoPrevisao {
  /** null = contrato não encontrado (removido). */
  contrato: ContratoPrevisao | null
  /** Já existe parcela REAL (aberta/paga) do contrato? Então a previsão sai. */
  temParcelasReais: boolean
  /** Previsão atual do contrato (status 'prevista'), se houver. */
  previsaoExistente: PrevisaoExistente | null
}

export type AcaoPrevisao =
  | { tipo: 'nenhuma' }
  | { tipo: 'remover'; id: string }
  | { tipo: 'criar'; valorCentavos: number; descricao: string }
  | { tipo: 'atualizar'; id: string; valorCentavos: number; descricao: string }

/** Descrição da previsão: título do contrato + forma de pagamento combinada (se houver). */
export function montarDescricaoPrevisao(titulo: string | null, formaPagamento: string | null): string {
  const base = `Previsão de recebimento — contrato ${(titulo ?? '').trim() || 'sem título'}`
  const forma = (formaPagamento ?? '').trim()
  return forma ? `${base} (forma: ${forma})` : base
}

/**
 * Decide o que fazer com a previsão a partir do estado observado (função PURA).
 * Regra: previsão deve existir quando o contrato existe, não está removido/
 * cancelado, tem valor_fixo>0, tem cliente (parcela exige cliente_id) e NÃO tem
 * parcela real. Caso contrário, remove a previsão se houver.
 */
export function decidirPrevisao(estado: EstadoPrevisao): AcaoPrevisao {
  const { contrato, temParcelasReais, previsaoExistente } = estado

  const valorCentavos =
    contrato && contrato.valor_fixo != null ? Math.round(Number(contrato.valor_fixo) * 100) : 0

  const deveExistir =
    !!contrato &&
    !contrato.deleted_at &&
    !STATUS_CONTRATO_INATIVO.has((contrato.status ?? '').toLowerCase()) &&
    valorCentavos > 0 &&
    !!contrato.cliente_id &&
    !temParcelasReais

  if (!deveExistir) {
    return previsaoExistente ? { tipo: 'remover', id: previsaoExistente.id } : { tipo: 'nenhuma' }
  }

  const descricao = montarDescricaoPrevisao(contrato!.titulo, contrato!.forma_pagamento)
  if (!previsaoExistente) return { tipo: 'criar', valorCentavos, descricao }
  if (previsaoExistente.valor_centavos !== valorCentavos || previsaoExistente.descricao !== descricao) {
    return { tipo: 'atualizar', id: previsaoExistente.id, valorCentavos, descricao }
  }
  return { tipo: 'nenhuma' }
}

/** hoje + n dias em YYYY-MM-DD, ancorado ao meio-dia UTC (imune a fuso/DST). */
function vencimentoEstimado(dias: number): string {
  const dt = new Date()
  dt.setUTCHours(12, 0, 0, 0)
  dt.setUTCDate(dt.getUTCDate() + dias)
  return dt.toISOString().slice(0, 10)
}

/**
 * Sincroniza a previsão de recebimento de um contrato com o estado atual.
 * Idempotente e com DEDUP (no máximo 1 previsão por contrato). BEST-EFFORT:
 * nunca lança — falhas só logam ids. `db` pode ser client de sessão ou admin.
 */
export async function sincronizarPrevisaoContrato(db: Db, contratoId: string): Promise<void> {
  try {
    const { data: contrato } = await db
      .from('contratos_honorarios')
      .select('tenant_id, valor_fixo, cliente_id, status, deleted_at, titulo, forma_pagamento')
      .eq('id', contratoId)
      .maybeSingle()

    // Sem contrato não há tenant para escopar as queries; a previsão órfã (se
    // existir) só é alcançável pelo próprio contrato_id — mas o hard-delete usa
    // ON DELETE SET NULL, então a rota DELETE remove a previsão ANTES de apagar.
    const tenantId = (contrato?.tenant_id as string | undefined) ?? null
    if (!tenantId) return

    // Previsões atuais do contrato (dedup: pode haver >1 por corrida/legado).
    const { data: previstas } = await db
      .from('parcelas')
      .select('id, valor_centavos, descricao')
      .eq('tenant_id', tenantId)
      .eq('contrato_id', contratoId)
      .eq('status', 'prevista')
      .order('created_at', { ascending: true })

    const lista = (previstas ?? []) as PrevisaoExistente[]
    // Mantém no máximo a primeira; remove as demais (garante 1 por contrato).
    if (lista.length > 1) {
      const extras = lista.slice(1).map((p) => p.id)
      await db.from('parcelas').delete().in('id', extras).eq('tenant_id', tenantId)
    }
    const previsaoExistente = lista[0] ?? null

    // Existe parcela REAL do contrato? (aberta/paga → a série substitui a previsão).
    const { data: reais } = await db
      .from('parcelas')
      .select('id')
      .eq('tenant_id', tenantId)
      .eq('contrato_id', contratoId)
      .in('status', ['aberta', 'paga'])
      .limit(1)
    const temParcelasReais = (reais?.length ?? 0) > 0

    const acao = decidirPrevisao({
      contrato: contrato
        ? {
            valor_fixo: contrato.valor_fixo as number | null,
            cliente_id: contrato.cliente_id as string | null,
            status: contrato.status as string | null,
            deleted_at: contrato.deleted_at as string | null,
            titulo: contrato.titulo as string | null,
            forma_pagamento: contrato.forma_pagamento as string | null,
          }
        : null,
      temParcelasReais,
      previsaoExistente,
    })

    if (acao.tipo === 'nenhuma') return

    if (acao.tipo === 'remover') {
      await db.from('parcelas').delete().eq('id', acao.id).eq('tenant_id', tenantId).eq('status', 'prevista')
      return
    }

    if (acao.tipo === 'atualizar') {
      // Só valor/descrição mudam; vencimento e cliente ficam como estavam.
      await db
        .from('parcelas')
        .update({ valor_centavos: acao.valorCentavos, descricao: acao.descricao })
        .eq('id', acao.id)
        .eq('tenant_id', tenantId)
        .eq('status', 'prevista')
      return
    }

    // criar — cliente_id é garantido non-null por decidirPrevisao (parcela exige).
    await db.from('parcelas').insert({
      tenant_id: tenantId,
      cliente_id: contrato!.cliente_id,
      contrato_id: contratoId,
      descricao: acao.descricao,
      valor_centavos: acao.valorCentavos,
      vencimento: vencimentoEstimado(DIAS_ESTIMATIVA),
      status: 'prevista',
    })
  } catch (err) {
    // Best-effort: a previsão nunca derruba a rota chamadora. LGPD: só o id.
    logger.error('financeiro.previsao.sync_falhou', { contratoId }, err as Error)
  }
}
