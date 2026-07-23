import { NextResponse } from 'next/server'
import { getAuthContext } from '@/lib/auth'
import { janelaDiaSaoPaulo } from '@/lib/tarefas/aviso-diario'
import { resolverVinculoView, type TaskVinculoData } from '@/lib/tarefas/vinculo'
import {
  compararMeuDia,
  escolherComecePorAqui,
  limitesDiaUTC,
  TETO_EXIBIDO,
  type ItemMeuDia,
  type Prioridade,
} from '@/lib/tarefas/meu-dia'

// GET /api/tasks/meu-dia — painel "Meu dia" do usuário logado.
//
// Junta as tarefas NÃO concluídas (responsável OU envolvido) em dois grupos:
//   - atrasadas: vencimento ANTES de hoje
//   - hoje:      vencimento HOJE
// no fuso America/Sao_Paulo. Cada item vem enxuto (id/titulo/prioridade/
// vinculoRotulo), ordenado por prioridade (urgente>alta>media>baixa) e vencimento.
//
// INVARIANTE: isto NÃO calcula prazo nem conclui nada — só LÊ due_date que um
// humano já definiu e ORDENA. Sem IA. LGPD: a resposta carrega só ids, títulos,
// prioridade e o rótulo do vínculo (nome do cliente/caso/processo já exibido nos
// cards) — nunca telefone/CPF.

// (lógica pura em src/lib/tarefas/meu-dia.ts — rota só pode exportar handler;
// helpers exportados aqui derrubam o build do Next)

/** Teto por subconsulta (responsável / envolvido). Um membro raramente tem mais
 *  que isto vencido/hoje; acima do teto a contagem total pode subestimar (aceito
 *  p/ um painel pessoal — nunca esconde item em silêncio, só limita a lista). */
const TETO_BUSCA = 100

// Campos da tarefa + joins do vínculo (mesmo shape que resolverVinculoView espera).
const SELECT_TAREFA = `
  id, description, due_date, priority, completed_at,
  cliente_id, process_id, processo_id,
  cliente:clientes!cliente_id(id, nome),
  atendimentos(id, area, numero_processo, clientes(id, nome)),
  processo:processos!processo_id(id, numero_cnj, apelido, clientes(id, nome))
`

type LinhaTarefa = TaskVinculoData & {
  id: string
  description: string
  due_date: string | null
  priority: Prioridade
  completed_at: string | null
}

/** Rótulo curto do vínculo (nome do cliente/apelido do processo/área do caso). */
function linhaParaItem(r: LinhaTarefa): ItemMeuDia {
  const view = resolverVinculoView(r)
  return {
    id: r.id,
    titulo: r.description,
    prioridade: r.priority,
    vinculoRotulo: view ? view.label : null,
  }
}

/** Dedup por id, ordena por prioridade+vencimento, corta no teto de exibição. */
function montarGrupo(linhas: LinhaTarefa[]): { itens: ItemMeuDia[]; total: number } {
  const porId = new Map<string, LinhaTarefa>()
  for (const l of linhas) porId.set(l.id, l)
  const ordenadas = [...porId.values()].sort(compararMeuDia)
  return {
    itens: ordenadas.slice(0, TETO_EXIBIDO).map(linhaParaItem),
    total: porId.size,
  }
}

export async function GET() {
  const auth = await getAuthContext()
  if (!auth.ok) return auth.response
  const { supabase, usuario } = auth

  const { dia } = janelaDiaSaoPaulo(new Date())
  const { inicioHojeUTC, inicioAmanhaUTC } = limitesDiaUTC(dia)

  // 4 consultas em paralelo: (atrasada|hoje) × (responsável|envolvido). RLS +
  // tenant garantem que só vêm tarefas do escritório do usuário. `lt`/`gte`
  // sobre timestamptz já excluem due_date nulo.
  const respBase = () =>
    supabase
      .from('tasks')
      .select(SELECT_TAREFA)
      .eq('tenant_id', usuario.tenant_id)
      .eq('assignee_id', usuario.id)
      .is('completed_at', null)
      .limit(TETO_BUSCA)

  const envBase = () =>
    supabase
      .from('task_assignees')
      .select(`user_id, task:tasks!inner(${SELECT_TAREFA})`)
      .eq('user_id', usuario.id)
      .eq('task.tenant_id', usuario.tenant_id)
      .is('task.completed_at', null)
      .limit(TETO_BUSCA)

  const [respAtras, respHoje, envAtras, envHoje] = await Promise.all([
    respBase().lt('due_date', inicioHojeUTC),
    respBase().gte('due_date', inicioHojeUTC).lt('due_date', inicioAmanhaUTC),
    envBase().lt('task.due_date', inicioHojeUTC),
    envBase().gte('task.due_date', inicioHojeUTC).lt('task.due_date', inicioAmanhaUTC),
  ])

  const primeiroErro = respAtras.error || respHoje.error || envAtras.error || envHoje.error
  if (primeiroErro) return NextResponse.json({ error: primeiroErro.message }, { status: 500 })

  // Extrai a tarefa embutida de cada linha de task_assignees (descarta órfãs).
  const desdobrar = (rows: { task: unknown }[] | null): LinhaTarefa[] =>
    (rows ?? []).map((r) => r.task as LinhaTarefa).filter(Boolean)

  const atras = montarGrupo([
    ...((respAtras.data ?? []) as unknown as LinhaTarefa[]),
    ...desdobrar(envAtras.data as { task: unknown }[] | null),
  ])
  const hoje = montarGrupo([
    ...((respHoje.data ?? []) as unknown as LinhaTarefa[]),
    ...desdobrar(envHoje.data as { task: unknown }[] | null),
  ])

  return NextResponse.json({
    atrasadas: atras.itens,
    hoje: hoje.itens,
    atrasadasTotal: atras.total,
    hojeTotal: hoje.total,
    comecePorAqui: escolherComecePorAqui(atras.itens, hoje.itens),
  })
}
