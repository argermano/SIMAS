'use client'

// Vista de mês: grade de semanas completas (Dom..Sáb) com itens por dia + "mais N".

import { useMemo, useState } from 'react'
import { cn } from '@/lib/utils'
import { semanasDoMes, chaveDia } from '@/lib/agenda/grade'
import type { EventoCalendario } from '@/lib/agenda/tipos'
import { ItemAgenda } from './ItemAgenda'

const DIAS_SEMANA = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb']
const MAX_VISIVEL = 3

interface GradeMesProps {
  dataRef: string
  eventos: EventoCalendario[]
  meUserId: string
  onItemClick: (evento: EventoCalendario) => void
}

function ordenar(a: EventoCalendario, b: EventoCalendario): number {
  if (a.diaTodo !== b.diaTodo) return a.diaTodo ? -1 : 1
  return a.inicio.localeCompare(b.inicio)
}

export function GradeMes({ dataRef, eventos, meUserId, onItemClick }: GradeMesProps) {
  const [expandidos, setExpandidos] = useState<Set<string>>(new Set())

  const semanas = useMemo(() => semanasDoMes(dataRef), [dataRef])
  const mesRef = useMemo(() => chaveDia(dataRef).slice(0, 7), [dataRef])
  const hojeKey = useMemo(() => chaveDia(new Date().toISOString()), [])

  const porDia = useMemo(() => {
    const mapa = new Map<string, EventoCalendario[]>()
    for (const ev of eventos) {
      const k = chaveDia(ev.inicio)
      const lista = mapa.get(k)
      if (lista) lista.push(ev)
      else mapa.set(k, [ev])
    }
    for (const lista of mapa.values()) lista.sort(ordenar)
    return mapa
  }, [eventos])

  function alternar(k: string) {
    setExpandidos(prev => {
      const prox = new Set(prev)
      if (prox.has(k)) prox.delete(k)
      else prox.add(k)
      return prox
    })
  }

  return (
    <div className="flex h-full min-h-0 flex-col rounded-xl border border-border bg-card">
      {/* Cabeçalho dos dias da semana */}
      <div className="grid grid-cols-7 border-b border-border">
        {DIAS_SEMANA.map(d => (
          <div key={d} className="px-2 py-2 text-center text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {d}
          </div>
        ))}
      </div>

      {/* Semanas */}
      <div className="grid flex-1 auto-rows-fr" style={{ gridTemplateRows: `repeat(${semanas.length}, minmax(0, 1fr))` }}>
        {semanas.map((semana, i) => (
          <div key={i} className="grid grid-cols-7">
            {semana.map(diaIso => {
              const k = chaveDia(diaIso)
              const doMes = k.slice(0, 7) === mesRef
              const isHoje = k === hojeKey
              const numero = Number(k.slice(8, 10))
              const lista = porDia.get(k) ?? []
              const aberto = expandidos.has(k)
              const visiveis = aberto ? lista : lista.slice(0, MAX_VISIVEL)
              const restantes = lista.length - visiveis.length

              return (
                <div
                  key={k}
                  className={cn(
                    'flex min-h-0 flex-col gap-0.5 overflow-hidden border-b border-r border-border p-1',
                    !doMes && 'bg-muted/30',
                  )}
                >
                  <div className="flex justify-end px-1">
                    <span
                      className={cn(
                        'inline-flex h-6 min-w-6 items-center justify-center rounded-full text-xs',
                        isHoje && 'bg-primary font-bold text-primary-foreground',
                        !isHoje && doMes && 'font-medium text-foreground',
                        !isHoje && !doMes && 'text-muted-foreground',
                      )}
                    >
                      {numero}
                    </span>
                  </div>

                  <div className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto">
                    {visiveis.map(ev => (
                      <ItemAgenda key={ev.id} evento={ev} meUserId={meUserId} onClick={onItemClick} />
                    ))}
                    {restantes > 0 && (
                      <button
                        type="button"
                        onClick={() => alternar(k)}
                        className="rounded px-1.5 py-0.5 text-left text-[11px] font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
                      >
                        + mais {restantes}
                      </button>
                    )}
                    {aberto && lista.length > MAX_VISIVEL && (
                      <button
                        type="button"
                        onClick={() => alternar(k)}
                        className="rounded px-1.5 py-0.5 text-left text-[11px] font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
                      >
                        ver menos
                      </button>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        ))}
      </div>
    </div>
  )
}
