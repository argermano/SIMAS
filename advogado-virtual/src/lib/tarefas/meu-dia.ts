// Lógica PURA do painel "Meu dia" (rota /api/tasks/meu-dia). Vive fora do
// arquivo de rota porque o Next só permite exports de handler em route.ts —
// exportar helpers de lá derruba o build ("is not a valid Route export field").

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

export interface TarefaOrdenavel {
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
