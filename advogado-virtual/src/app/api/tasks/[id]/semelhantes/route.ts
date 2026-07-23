import { NextResponse } from 'next/server'
import { getAuthContext } from '@/lib/auth'
import { jsonError } from '@/lib/api'
import { classificarAcaoTarefa, detectarTipoPeca, type AcaoConcreta } from '@/lib/tarefas/acao'
import { resolverVinculoView, colunasParaVinculo, type TaskVinculoData } from '@/lib/tarefas/vinculo'
import { TIPOS_PECA } from '@/lib/constants/tipos-peca'

export const maxDuration = 15

// Quantas tarefas concluídas (mais recentes) varremos para achar as 3 do MESMO
// trabalho. Teto p/ não escanear o histórico inteiro do escritório (perf/LGPD):
// como ~metade das tarefas é peça, 200 recentes rendem folgadamente 3 iguais.
const LIMITE_VARREDURA = 200
// Quantas semelhantes devolvemos no máximo (guia discreto, não um relatório).
const MAX_SEMELHANTES = 3

// Vínculo (p/ o rótulo e p/ achar o atendimento com peça) + campos p/ classificar.
// Mesmos joins do embed da lista de tarefas, reduzidos ao necessário.
const SELECT = `
  id, description, completed_at,
  process_id, cliente_id, processo_id,
  atendimentos(id, area, numero_processo, clientes(id, nome)),
  cliente:clientes!cliente_id(id, nome),
  processo:processos!processo_id(id, numero_cnj, apelido, clientes(id, nome))
`

// ── Critério de "mesmo trabalho" (puro/determinístico — testável) ───────────

/** O que caracteriza o trabalho de uma tarefa: a família + (só p/ peça) o tipo. */
export interface CriterioSemelhanca {
  acao: AcaoConcreta
  /** Tipo de peça detectado (apelacao/contrarrazoes/...). null = peça genérica
   *  (ex.: MANIFESTAR/EMENDA, sem tipo no mapa) — casa com outra genérica. */
  tipoPeca: string | null
}

/**
 * Deriva o critério do título da tarefa atual. null quando a ação é
 * 'indefinido' (sem família clara não há grupo de referência a buscar).
 */
export function criterioDaTarefa(titulo: string): CriterioSemelhanca | null {
  const acao = classificarAcaoTarefa(titulo)
  if (acao === 'indefinido') return null
  return { acao, tipoPeca: acao === 'peca' ? detectarTipoPeca(titulo) : null }
}

/**
 * Um título candidato "combina" com o critério quando classifica na MESMA ação
 * e — para peça — detecta o MESMO tipo (APELAÇÃO com APELAÇÃO; peça genérica com
 * peça genérica). Comparação por igualdade (inclui null === null).
 */
export function combinaComCriterio(criterio: CriterioSemelhanca, tituloCandidato: string): boolean {
  if (classificarAcaoTarefa(tituloCandidato) !== criterio.acao) return false
  if (criterio.acao === 'peca') return detectarTipoPeca(tituloCandidato) === criterio.tipoPeca
  return true
}

// ── Extração do atendimento vinculado (p/ buscar a peça de referência) ──────

/** Id do atendimento (caso) vinculado à tarefa, ou null quando o vínculo é
 *  cliente/processo/nenhum — só o caso tem peça gerada associada. */
export function atendimentoVinculado(row: {
  cliente_id?: string | null
  process_id?: string | null
  processo_id?: string | null
}): string | null {
  const v = colunasParaVinculo(row)
  return v?.tipo === 'atendimento' ? v.id : null
}

/** Título legível do tipo da peça (fonte única TIPOS_PECA; fallback do slug). */
export function tituloDaPeca(tipo: string): string {
  return TIPOS_PECA[tipo]?.nome ?? tipo.replace(/_/g, ' ')
}

// ── Handler ─────────────────────────────────────────────────────────────────

interface SemelhanteRow extends TaskVinculoData {
  id: string
  description: string | null
  completed_at: string | null
}

/**
 * GET /api/tasks/[id]/semelhantes — até 3 tarefas CONCLUÍDAS do mesmo tenant que
 * representam o MESMO trabalho da tarefa atual (mesma ação classificada; p/ peça,
 * também o mesmo tipo), mais recentes primeiro. Para cada uma, se o atendimento
 * vinculado tiver peça gerada, inclui a mais recente como referência de leitura.
 *
 * Só ATALHOS de leitura: nada é copiado, gerado ou concluído. Determinístico
 * (sem IA) — reusa o classificador de acao.ts.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const auth = await getAuthContext()
  if (!auth.ok) return auth.response
  const { supabase, usuario } = auth

  // Tarefa atual: só o título basta para derivar o critério.
  const { data: atual, error: errAtual } = await supabase
    .from('tasks')
    .select('id, description')
    .eq('id', id)
    .eq('tenant_id', usuario.tenant_id)
    .maybeSingle()

  if (errAtual) return jsonError(errAtual.message, 500)
  if (!atual) return jsonError('Tarefa não encontrada', 404)

  const criterio = criterioDaTarefa((atual.description as string | null) ?? '')
  if (!criterio) return NextResponse.json({ semelhantes: [] })

  // Concluídas do escritório, mais recentes primeiro (teto de varredura), fora a atual.
  const { data: rows, error } = await supabase
    .from('tasks')
    .select(SELECT)
    .eq('tenant_id', usuario.tenant_id)
    .not('completed_at', 'is', null)
    .neq('id', id)
    .order('completed_at', { ascending: false })
    .limit(LIMITE_VARREDURA)

  if (error) return jsonError(error.message, 500)

  const candidatos = (rows ?? []) as unknown as SemelhanteRow[]
  const escolhidas = candidatos
    .filter((r) => combinaComCriterio(criterio, r.description ?? ''))
    .slice(0, MAX_SEMELHANTES)

  if (escolhidas.length === 0) return NextResponse.json({ semelhantes: [] })

  // Peça de referência: 1 query batelada por atendimento vinculado das escolhidas.
  const atendimentoPorTask = new Map<string, string>()
  for (const r of escolhidas) {
    const at = atendimentoVinculado(r)
    if (at) atendimentoPorTask.set(r.id, at)
  }
  const atendimentoIds = [...new Set(atendimentoPorTask.values())]

  // atendimentoId → { id, tipo, area } da peça MAIS RECENTE daquele caso.
  const pecaPorAtendimento = new Map<string, { id: string; tipo: string; area: string }>()
  if (atendimentoIds.length > 0) {
    const { data: pecas } = await supabase
      .from('pecas')
      .select('id, tipo, area, atendimento_id, created_at')
      .eq('tenant_id', usuario.tenant_id)
      .in('atendimento_id', atendimentoIds)
      .order('created_at', { ascending: false })
    for (const p of (pecas ?? []) as { id: string; tipo: string; area: string; atendimento_id: string }[]) {
      // ordenado desc → o primeiro visto de cada caso é o mais recente.
      if (!pecaPorAtendimento.has(p.atendimento_id)) {
        pecaPorAtendimento.set(p.atendimento_id, { id: p.id, tipo: p.tipo, area: p.area })
      }
    }
  }

  const semelhantes = escolhidas.map((r) => {
    const vinc = resolverVinculoView(r)
    const at = atendimentoPorTask.get(r.id)
    const peca = at ? pecaPorAtendimento.get(at) : undefined
    return {
      id: r.id,
      titulo: r.description ?? '',
      concluidaEm: r.completed_at,
      vinculoRotulo: vinc?.label ?? null,
      ...(peca
        ? {
            pecaId: peca.id,
            pecaTitulo: tituloDaPeca(peca.tipo),
            // Editor da casa: /{area}/editor/{pecaId} (mesma rota do link de revisão).
            pecaHref: `/${peca.area}/editor/${peca.id}`,
          }
        : {}),
    }
  })

  return NextResponse.json({ semelhantes })
}
