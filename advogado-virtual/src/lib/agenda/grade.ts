// Matemática de datas da grade, ancorada em America/Sao_Paulo.
// PURA: recebe/retorna strings ISO (instantes UTC) e números; nenhum I/O.
// Não há date-fns — usamos Date + Intl, no estilo de KanbanCalendar.tsx.

import type { Vista, IntervaloVista } from './tipos'

const TZ = 'America/Sao_Paulo'
const DIA_MS = 86_400_000

const MESES = [
  'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
  'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro',
]

const _fmt = new Intl.DateTimeFormat('en-US', {
  timeZone: TZ,
  year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit',
  hour12: false,
})

interface CivilParts {
  year: number
  month: number // 1..12
  day: number
  hour: number
  minute: number
  second: number
}

/** Componentes de parede (wall-clock) de um instante, na TZ de SP. */
function partesSP(instant: Date): CivilParts {
  const m: Record<string, number> = {}
  for (const p of _fmt.formatToParts(instant)) {
    if (p.type !== 'literal') m[p.type] = Number(p.value)
  }
  return {
    year: m.year,
    month: m.month,
    day: m.day,
    hour: m.hour % 24, // alguns ICU emitem 24 p/ meia-noite
    minute: m.minute,
    second: m.second,
  }
}

/** Offset (ms) de SP em relação a UTC no instante dado (negativo em SP). */
function offsetMs(instant: Date): number {
  const p = partesSP(instant)
  const asUTC = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second)
  return asUTC - instant.getTime()
}

/** Converte um horário de parede (SP) para o instante UTC correspondente. */
function paredeSPparaUTC(
  y: number, mo: number, d: number,
  h = 0, mi = 0, s = 0, ms = 0,
): Date {
  const guess = Date.UTC(y, mo - 1, d, h, mi, s, ms)
  let utc = guess - offsetMs(new Date(guess))
  // Refina uma vez (cobre viradas de DST históricas).
  utc = guess - offsetMs(new Date(utc))
  return new Date(utc)
}

/** Dia da semana civil (0=Dom..6=Sáb) para uma data civil. */
function diaSemanaCivil(y: number, mo: number, d: number): number {
  return new Date(Date.UTC(y, mo - 1, d)).getUTCDay()
}

function pad(n: number): string {
  return String(n).padStart(2, '0')
}

/** Início do dia (00:00:00 SP) do dia civil que contém `iso`, como instante. */
function inicioDoDia(iso: string): Date {
  const p = partesSP(new Date(iso))
  return paredeSPparaUTC(p.year, p.month, p.day, 0, 0, 0, 0)
}

/** Fim do dia (último ms, 23:59:59.999 SP) do dia civil (y,mo,d), como instante. */
function fimDoDiaCivil(y: number, mo: number, d: number): Date {
  const proximo = new Date(Date.UTC(y, mo - 1, d) + DIA_MS)
  const inicioProximo = paredeSPparaUTC(
    proximo.getUTCFullYear(), proximo.getUTCMonth() + 1, proximo.getUTCDate(),
    0, 0, 0, 0,
  )
  return new Date(inicioProximo.getTime() - 1)
}

/** As 24 horas do dia (0..23), para as linhas da grade. */
export function horas(): number[] {
  return Array.from({ length: 24 }, (_, i) => i)
}

/** Chave de dia 'YYYY-MM-DD' na TZ de SP para um instante ISO. */
export function chaveDia(iso: string): string {
  const p = partesSP(new Date(iso))
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`
}

/** `true` se dois instantes caem no mesmo dia civil de SP. */
export function mesmoDia(a: string, b: string): boolean {
  return chaveDia(a) === chaveDia(b)
}

/** Os 7 dias (Dom..Sáb) da semana que contém `dataRef`, como ISO de início-de-dia (SP). */
export function diasDaSemana(dataRef: string): string[] {
  const p = partesSP(new Date(dataRef))
  const dow = diaSemanaCivil(p.year, p.month, p.day)
  const baseCivil = Date.UTC(p.year, p.month - 1, p.day)
  const dias: string[] = []
  for (let i = 0; i < 7; i++) {
    const c = new Date(baseCivil + (i - dow) * DIA_MS)
    dias.push(
      paredeSPparaUTC(c.getUTCFullYear(), c.getUTCMonth() + 1, c.getUTCDate())
        .toISOString(),
    )
  }
  return dias
}

/**
 * As semanas da grade do mês que contém `dataRef` — semanas completas (Dom..Sáb),
 * incluindo dias de meses adjacentes p/ preencher a grade. Cada dia é ISO de início-de-dia (SP).
 */
export function semanasDoMes(dataRef: string): string[][] {
  const p = partesSP(new Date(dataRef))
  const primeiroDow = diaSemanaCivil(p.year, p.month, 1)
  const inicioGrade = Date.UTC(p.year, p.month - 1, 1) - primeiroDow * DIA_MS

  const ultimoDia = new Date(Date.UTC(p.year, p.month, 0)).getUTCDate()
  const ultimoDow = diaSemanaCivil(p.year, p.month, ultimoDia)
  const fimGrade = Date.UTC(p.year, p.month - 1, ultimoDia) + (6 - ultimoDow) * DIA_MS

  const semanas: string[][] = []
  let semana: string[] = []
  for (let t = inicioGrade; t <= fimGrade; t += DIA_MS) {
    const c = new Date(t)
    semana.push(
      paredeSPparaUTC(c.getUTCFullYear(), c.getUTCMonth() + 1, c.getUTCDate())
        .toISOString(),
    )
    if (semana.length === 7) {
      semanas.push(semana)
      semana = []
    }
  }
  return semanas
}

/**
 * Intervalo [de, ate] (ISO, ambos inclusivos) coberto por uma vista:
 * - 'dia'   → o dia inteiro de `dataRef`.
 * - 'semana'→ Dom..Sáb da semana de `dataRef`.
 * - 'mes'   → toda a grade do mês (semanas completas Dom..Sáb).
 */
export function intervaloDaVista(vista: Vista, dataRef: string): IntervaloVista {
  if (vista === 'dia') {
    const p = partesSP(new Date(dataRef))
    return {
      de: paredeSPparaUTC(p.year, p.month, p.day, 0, 0, 0, 0).toISOString(),
      ate: fimDoDiaCivil(p.year, p.month, p.day).toISOString(),
    }
  }

  if (vista === 'semana') {
    const dias = diasDaSemana(dataRef)
    const fimP = partesSP(new Date(dias[6]))
    return {
      de: dias[0],
      ate: fimDoDiaCivil(fimP.year, fimP.month, fimP.day).toISOString(),
    }
  }

  // mes
  const semanas = semanasDoMes(dataRef)
  const primeiro = semanas[0][0]
  const ultimaSemana = semanas[semanas.length - 1]
  const ultimoP = partesSP(new Date(ultimaSemana[6]))
  return {
    de: inicioDoDia(primeiro).toISOString(),
    ate: fimDoDiaCivil(ultimoP.year, ultimoP.month, ultimoP.day).toISOString(),
  }
}

/** Rótulo do período (pt-BR) para o cabeçalho da barra da agenda. */
export function rotuloPeriodo(vista: Vista, dataRef: string): string {
  if (vista === 'dia') {
    const p = partesSP(new Date(dataRef))
    return `${p.day} de ${MESES[p.month - 1]} de ${p.year}`
  }

  if (vista === 'semana') {
    const dias = diasDaSemana(dataRef)
    const a = partesSP(new Date(dias[0]))
    const b = partesSP(new Date(dias[6]))
    if (a.year === b.year && a.month === b.month) {
      return `${a.day} – ${b.day} de ${MESES[a.month - 1]} de ${a.year}`
    }
    if (a.year === b.year) {
      return `${a.day} de ${MESES[a.month - 1]} – ${b.day} de ${MESES[b.month - 1]} de ${b.year}`
    }
    return `${a.day} de ${MESES[a.month - 1]} de ${a.year} – ${b.day} de ${MESES[b.month - 1]} de ${b.year}`
  }

  // mes
  const p = partesSP(new Date(dataRef))
  return `${MESES[p.month - 1]} de ${p.year}`
}
