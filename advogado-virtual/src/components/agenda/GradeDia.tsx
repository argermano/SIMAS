'use client'

// Vista de dia: faixa "Dia todo" + grade de horas de um único dia.

import { useMemo } from 'react'
import { cn } from '@/lib/utils'
import { chaveDia, horas } from '@/lib/agenda/grade'
import type { EventoCalendario } from '@/lib/agenda/tipos'
import { ItemAgenda, horaSP } from './ItemAgenda'

interface GradeDiaProps {
  dataRef: string
  eventos: EventoCalendario[]
  meUserId: string
  onItemClick: (evento: EventoCalendario) => void
}

function ordenar(a: EventoCalendario, b: EventoCalendario): number {
  return a.inicio.localeCompare(b.inicio)
}

export function GradeDia({ dataRef, eventos, meUserId, onItemClick }: GradeDiaProps) {
  const diaKey = useMemo(() => chaveDia(dataRef), [dataRef])
  const linhas = useMemo(() => horas(), [])

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

  return (
    <div className="flex h-full min-h-0 flex-col rounded-xl border border-border bg-card">
      {/* Faixa "Dia todo" */}
      <div className={cn('grid border-b border-border', colTemplate)}>
        <div className="flex items-center justify-end border-r border-border px-2 py-1 text-[11px] font-medium text-muted-foreground">
          Dia todo
        </div>
        <div className="flex min-h-[2.25rem] flex-col gap-0.5 p-1">
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
              <div className="flex min-h-[3rem] flex-col gap-0.5 border-b border-border p-1">
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
