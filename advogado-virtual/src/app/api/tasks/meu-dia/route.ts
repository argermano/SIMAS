import { NextResponse } from 'next/server'
import { getAuthContext } from '@/lib/auth'
import { janelaDiaSaoPaulo } from '@/lib/tarefas/aviso-diario'
import { resolverVinculoView, type TaskVinculoData } from '@/lib/tarefas/vinculo'

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

export type Prioridade = 'baixa' | 'media' | 'alta' | 'urgente'

/** Peso p/ ordenar do mais ao menos urgente (ascendente = urgente primeiro). */
export const PESO_PRIORIDADE: Record<Prioridade, number> = {
  urgente: 0,
  alta: 1,
  media: 2,
  baixa: 3,
}

export interface ItemMeuDia {
  id: string
  titulo: string
  prioridade: Prioridade
  vinculoRotulo: string | null
}

/** Teto de itens exibidos por grupo (a contagem total vai separada). */
export const TETO_EXIBIDO = 15
/** Teto por subconsulta (responsável / envolvido). Um membro raramente tem mais
 *  que isto vencido/hoje; acima do teto a contagem total pode subestimar (aceito
 *  p/ um painel pessoal — nunca esconde item em silêncio, só limita a lista). */
const TETO_BUSCA = 100

interface TarefaOrdenavel {
  priority: Prioridade
  due_date: string | null
}

/**
 * Ordena do mais urgente ao menos urgente e, em empate, do vencimento mais
 * antigo ao mais novo. Pura (sem rede/DB) — testável. A tarefa sem due_date vai
 * para o fim do empate (não deveria ocorrer aqui, pois os grupos têm vencimento).
 */
export function compararMeuDia(a: TarefaOrdenavel, b: TarefaOrdenavel): number {
  const pa = PESO_PRIORIDADE[a.priority] ?? 99
  const pb = PESO_PRIORIDADE[b.priority] ?? 99
  if (pa !== pb) return pa - pb
  const da = a.due_date ? Date.parse(a.due_date) : Number.POSITIVE_INFINITY
  const db = b.due_date ? Date.parse(b.due_date) : Number.POSITIVE_INFINITY
  return da - db
}

/**
 * Fronteiras em meia-noite UTC do dia civil de São Paulo (`diaSP` = 'YYYY-MM-DD').
 * due_date é um DIA guardado como meia-noite UTC (ver TaskCard) — por isso as
 * fronteiras são meia-noite UTC do dia, e NÃO o instante SP (00:00 SP = 03:00Z),
 * que classificaria a tarefa de hoje como atrasada. Assim o painel bate 1:1 com
 * o destaque vermelho/âmbar dos cards. `Date.UTC(...,d+1)` cuida da virada de mês.
 */
export function limitesDiaUTC(diaSP: string): { inicioHojeUTC: string; inicioAmanhaUTC: string } {
  const [y, m, d] = diaSP.split('-').map(Number)
  return {
    inicioHojeUTC: new Date(Date.UTC(y, m - 1, d)).toISOString(),
    inicioAmanhaUTC: new Date(Date.UTC(y, m - 1, d + 1)).toISOString(),
  }
}

/**
 * Escolha determinística e transparente do "Comece por aqui": a mais urgente
 * entre as atrasadas; na ausência de atrasadas, a mais urgente entre as de hoje.
 * Como cada grupo já vem ordenado, é o primeiro item do grupo escolhido. O
 * `criterio` é o subtítulo que a UI mostra para deixar a regra explícita.
 */
export function escolherComecePorAqui(
  atrasadas: ItemMeuDia[],
  hoje: ItemMeuDia[],
): { id: string; criterio: string } | null {
  if (atrasadas.length > 0) return { id: atrasadas[0].id, criterio: 'A mais urgente entre as atrasadas' }
  if (hoje.length > 0) return { id: hoje[0].id, criterio: 'A mais urgente entre as que vencem hoje' }
  return null
}

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
