import { NextRequest, NextResponse } from 'next/server'
import { getAuthContext, requireRole } from '@/lib/auth'
import { jsonError } from '@/lib/api'
import { buscarEventosCalendario } from '@/lib/agenda/consulta'
import { aplicaFiltros } from '@/lib/agenda/filtros'
import type {
  FiltroAgenda,
  FonteAgenda,
  StatusItem,
  Atribuicao,
  Visibilidade,
  Vista,
} from '@/lib/agenda/tipos'

// GET /api/agenda?de&ate&vista&tipos&status&atribuicao&pessoas&equipes&tags&q
// Agrega tarefas + agenda_eventos + consultas (funil_leads) no intervalo [de,ate]
// escopado por tenant via buscarEventosCalendario (consulta.ts) e filtra
// (filtros.ts com meUserId — o corte de 'particular' de terceiros é feito aqui).

const FONTES_VALIDAS: FonteAgenda[] = ['tarefa', 'evento', 'prazo', 'audiencia', 'consulta']
const ATRIBUICOES_VALIDAS: Atribuicao[] = ['responsavel', 'envolvido', 'criador']
const EQUIPES_VALIDAS: Visibilidade[] = ['escritorio', 'particular']
const VISTAS_VALIDAS: Vista[] = ['dia', 'semana', 'mes']

/** CSV -> lista de strings limpa (sem vazios). */
function csv(v: string | null): string[] {
  if (!v) return []
  return v.split(',').map(s => s.trim()).filter(Boolean)
}

export async function GET(req: NextRequest) {
  const auth = await getAuthContext()
  if (!auth.ok) return auth.response
  const gate = requireRole(auth.usuario, ['admin', 'advogado', 'colaborador'])
  if (gate) return gate
  const { supabase, usuario } = auth

  const { searchParams } = new URL(req.url)
  const de = searchParams.get('de')
  const ate = searchParams.get('ate')
  if (!de || !ate) return jsonError('Parâmetros "de" e "ate" são obrigatórios (ISO)', 400)

  const vistaParam = searchParams.get('vista') as Vista | null
  const vista: Vista = vistaParam && VISTAS_VALIDAS.includes(vistaParam) ? vistaParam : 'semana'

  const statusParam = searchParams.get('status')
  const status: FiltroAgenda['status'] =
    statusParam && ['a_concluir', 'concluida', 'cancelada'].includes(statusParam)
      ? (statusParam as StatusItem)
      : 'todas'

  const filtro: FiltroAgenda = {
    de,
    ate,
    vista,
    tipos: csv(searchParams.get('tipos')).filter((t): t is FonteAgenda => FONTES_VALIDAS.includes(t as FonteAgenda)),
    status,
    atribuicao: csv(searchParams.get('atribuicao')).filter((a): a is Atribuicao => ATRIBUICOES_VALIDAS.includes(a as Atribuicao)),
    pessoas: csv(searchParams.get('pessoas')),
    equipes: csv(searchParams.get('equipes')).filter((e): e is Visibilidade => EQUIPES_VALIDAS.includes(e as Visibilidade)),
    tags: csv(searchParams.get('tags')),
    q: searchParams.get('q') ?? '',
  }

  // ── Busca + normalização compartilhada (consulta.ts) ───────────────────────
  let eventos
  try {
    eventos = await buscarEventosCalendario(supabase, {
      tenantId: usuario.tenant_id,
      de,
      ate,
      // Reforço na query (defesa em profundidade): 'particular' de terceiros
      // já não vem do banco; aplicaFiltros repete o corte em memória.
      particularesDe: usuario.id,
    })
  } catch (e) {
    return jsonError(e instanceof Error ? e.message : 'Erro ao buscar agenda', 500)
  }

  // ── Filtros (particular cortado SEMPRE via meUserId) ───────────────────────
  const filtrados = aplicaFiltros(eventos, filtro, usuario.id)

  return NextResponse.json({ eventos: filtrados })
}
