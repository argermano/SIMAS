// Filtragem PURA de eventos do calendário. Nenhum I/O.
// INVARIANTE DURA: item 'particular' só aparece para o próprio criador.

import type { EventoCalendario, FiltroAgenda, Atribuicao } from './tipos'

/** Normaliza texto p/ busca: minúsculas + sem acentos. */
function normalizar(s: string): string {
  return s.toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '')
}

/** IDs de usuário relevantes no evento, conforme as dimensões de atribuição escolhidas. */
function idsPorAtribuicao(evento: EventoCalendario, dims: Atribuicao[]): Set<string> {
  // Vazio => considera todas as dimensões (defensivo).
  const usar = dims.length > 0 ? dims : (['responsavel', 'envolvido', 'criador'] as Atribuicao[])
  const ids = new Set<string>()
  if (usar.includes('responsavel') && evento.responsavel) ids.add(evento.responsavel.id)
  if (usar.includes('envolvido')) for (const e of evento.envolvidos) ids.add(e.id)
  if (usar.includes('criador') && evento.criadoPor) ids.add(evento.criadoPor)
  return ids
}

/** Concatena os campos textuais pesquisáveis do evento. */
function textoBusca(evento: EventoCalendario): string {
  const partes = [
    evento.titulo,
    evento.processo?.numero,
    evento.processo?.titulo,
    evento.cliente?.nome,
    evento.responsavel?.nome,
    ...evento.envolvidos.map(e => e.nome),
    ...evento.tags.map(t => t.nome),
  ].filter(Boolean) as string[]
  return normalizar(partes.join(' '))
}

/**
 * Aplica todos os filtros da agenda a uma lista de eventos.
 * `meUserId` é o usuário logado — usado para o corte de visibilidade 'particular'.
 * Convenções de "vazio = todos": ver `FiltroAgenda` em ./tipos.
 */
export function aplicaFiltros(
  eventos: EventoCalendario[],
  filtro: FiltroAgenda,
  meUserId: string,
): EventoCalendario[] {
  const pessoas = new Set(filtro.pessoas)
  const tags = new Set(filtro.tags)
  const q = normalizar(filtro.q.trim())

  return eventos.filter(ev => {
    // 0) Visibilidade 'particular' — SEMPRE, independente de qualquer filtro.
    if (ev.visibilidade === 'particular' && ev.criadoPor !== meUserId) return false

    // 1) Tipos (fontes). Vazio => todos.
    if (filtro.tipos.length > 0 && !filtro.tipos.includes(ev.fonte)) return false

    // 2) Status. 'todas' => sem restrição.
    if (filtro.status !== 'todas' && ev.status !== filtro.status) return false

    // 3) Pessoas × Atribuição. pessoas vazio => todos.
    if (pessoas.size > 0) {
      const ids = idsPorAtribuicao(ev, filtro.atribuicao)
      let bate = false
      for (const id of ids) {
        if (pessoas.has(id)) { bate = true; break }
      }
      if (!bate) return false
    }

    // 4) Equipes / visibilidade. Vazio => todos.
    if (filtro.equipes.length > 0 && !filtro.equipes.includes(ev.visibilidade)) return false

    // 5) Tags (por nome). Vazio => todos.
    if (tags.size > 0) {
      if (!ev.tags.some(t => tags.has(t.nome))) return false
    }

    // 6) Busca textual.
    if (q.length > 0 && !textoBusca(ev).includes(q)) return false

    return true
  })
}
