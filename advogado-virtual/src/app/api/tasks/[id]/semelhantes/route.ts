import { NextResponse } from 'next/server'
import { getAuthContext } from '@/lib/auth'
import { jsonError } from '@/lib/api'
import { resolverVinculoView, type TaskVinculoData } from '@/lib/tarefas/vinculo'
import {
  criterioDaTarefa,
  combinaComCriterio,
  atendimentoVinculado,
  tituloDaPeca,
} from '@/lib/tarefas/semelhantes'

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

// ── Handler ─────────────────────────────────────────────────────────────────
// (a lógica pura de critério/vínculo vive em src/lib/tarefas/semelhantes.ts —
// rota só pode exportar handler; helpers exportados aqui derrubam o build)

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
