'use client'

// Vista de dia (redesign): faixa de cabeçalho creme com o dia (hoje em círculo
// escuro), faixa "Dia todo" e grade de horas com pílulas pastel.
// Clique na área das células seleciona o dia (highlight sutil).

import { useMemo } from 'react'
import { cn } from '@/lib/utils'
import { chaveDia, horas } from '@/lib/agenda/grade'
import type { EventoCalendario } from '@/lib/agenda/tipos'
import { ItemAgenda, horaSP } from './ItemAgenda'

const DIAS_SEMANA = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb']

interface GradeDiaProps {
  dataRef: string
  eventos: EventoCalendario[]
  meUserId: string
  onItemClick: (evento: EventoCalendario) => void
  /** Clique na área da célula seleciona o dia (ISO início de dia). */
  onSelecionarDia?: (diaISO: string) => void
  /** Dia selecionado (ISO início de dia) — highlight sutil. */
  diaSelecionado?: string | null
}

function ordenar(a: EventoCalendario, b: EventoCalendario): number {
  return a.inicio.localeCompare(b.inicio)
}

export function GradeDia({
  dataRef,
  eventos,
  meUserId,
  onItemClick,
  onSelecionarDia,
  diaSelecionado,
}: GradeDiaProps) {
  const diaKey = useMemo(() => chaveDia(dataRef), [dataRef])
  const linhas = useMemo(() => horas(), [])
  const hojeKey = useMemo(() => chaveDia(new Date().toISOString()), [])
  const selKey = useMemo(() => (diaSelecionado ? chaveDia(diaSelecionado) : null), [diaSelecionado])

  // ISO do início do dia civil (SP é UTC-3 fixo desde 2019).
  const diaInicioISO = useMemo(
    () => new Date(`${diaKey}T00:00:00-03:00`).toISOString(),
    [diaKey],
  )
  const dow = useMemo(() => new Date(`${diaKey}T00:00:00Z`).getUTCDay(), [diaKey])
  const isHoje = diaKey === hojeKey
  const selecionado = diaKey === selKey

  const { diaTodo, porHora } = useMemo(() => {
    const diaTodo: EventoCalendario[] = []
    const porHora = new Map<number, EventoCalendario[]>()
    for (const ev of eventos) {
      if (chaveDia(ev.inicio) !== diaKey) continue
      if (ev.diaTodo) {
        diaTodo.push(ev)
      } else {
        const h = horaSP(ev.inicio)
        const l = porHora.get(h)
        if (l) l.push(ev); else porHora.set(h, [ev])
      }
    }
    diaTodo.sort(ordenar)
    for (const l of porHora.values()) l.sort(ordenar)
    return { diaTodo, porHora }
  }, [eventos, diaKey])

  const colTemplate = 'grid-cols-[3.5rem_minmax(0,1fr)]'

  function selecionar() {
    onSelecionarDia?.(diaInicioISO)
  }

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-xl border border-border bg-card">
      {/* Faixa creme com o dia */}
      <div className={cn('grid rounded-t-xl border-b border-border bg-muted/60 dark:bg-muted/30', colTemplate)}>
        <div className="border-r border-border" />
        <div
          role="button"
          tabIndex={0}
          aria-pressed={selecionado}
          onClick={selecionar}
          onKeyDown={e => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault()
              selecionar()
            }
          }}
          className={cn(
            'flex cursor-pointer items-center gap-2 px-3 py-2 transition-colors hover:bg-muted/40',
            selecionado && 'bg-primary/5 ring-1 ring-inset ring-primary/50',
          )}
        >
          <span className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
            {DIAS_SEMANA[dow]}
          </span>
          <span
            className={cn(
              'inline-flex h-7 min-w-7 items-center justify-center rounded-full text-sm',
              isHoje
                ? 'w-7 bg-foreground font-semibold text-background'
                : 'font-medium text-foreground',
            )}
          >
            {Number(diaKey.slice(8, 10))}
          </span>
        </div>
      </div>

      {/* Faixa "Dia todo" */}
      <div className={cn('grid border-b border-border', colTemplate)}>
        <div className="flex items-center justify-end border-r border-border px-2 py-1 text-[11px] font-medium text-muted-foreground">
          Dia todo
        </div>
        <div
          onClick={selecionar}
          className={cn(
            'flex min-h-[2.25rem] cursor-pointer flex-col gap-0.5 p-1 transition-colors hover:bg-muted/20',
            selecionado && 'bg-primary/5',
          )}
        >
          {diaTodo.map(ev => (
            <ItemAgenda key={ev.id} evento={ev} meUserId={meUserId} onClick={onItemClick} />
          ))}
        </div>
      </div>

      {/* Grade de horas */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {linhas.map(h => {
          const lista = porHora.get(h) ?? []
          return (
            <div key={h} className={cn('grid', colTemplate)}>
              <div className="border-r border-b border-border px-2 py-1 text-right text-[11px] tabular-nums text-muted-foreground">
                {String(h).padStart(2, '0')}:00
              </div>
              <div
                onClick={selecionar}
                className={cn(
                  'flex min-h-[3rem] cursor-pointer flex-col gap-0.5 border-b border-border p-1 transition-colors hover:bg-muted/20',
                  selecionado && 'bg-primary/5',
                )}
              >
                {lista.map(ev => (
                  <ItemAgenda key={ev.id} evento={ev} meUserId={meUserId} onClick={onItemClick} mostrarHora />
                ))}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
