'use client'

// Vista de semana: colunas Dom..Sáb, faixa "Dia todo" e grade de horas.

import { useMemo, useState } from 'react'
import { cn } from '@/lib/utils'
import { diasDaSemana, chaveDia, horas } from '@/lib/agenda/grade'
import type { EventoCalendario } from '@/lib/agenda/tipos'
import { ItemAgenda, horaSP } from './ItemAgenda'

const DIAS_SEMANA = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb']
const MAX_CELULA = 3

interface GradeSemanaProps {
  dataRef: string
  eventos: EventoCalendario[]
  meUserId: string
  onItemClick: (evento: EventoCalendario) => void
}

function ordenar(a: EventoCalendario, b: EventoCalendario): number {
  return a.inicio.localeCompare(b.inicio)
}

export function GradeSemana({ dataRef, eventos, meUserId, onItemClick }: GradeSemanaProps) {
  const [expandidos, setExpandidos] = useState<Set<string>>(new Set())

  const dias = useMemo(() => diasDaSemana(dataRef), [dataRef])
  const linhas = useMemo(() => horas(), [])
  const hojeKey = useMemo(() => chaveDia(new Date().toISOString()), [])

  const { diaTodo, cronologico } = useMemo(() => {
    const diaTodo = new Map<string, EventoCalendario[]>()
    const cronologico = new Map<string, EventoCalendario[]>()
    for (const ev of eventos) {
      const dk = chaveDia(ev.inicio)
      if (ev.diaTodo) {
        const l = diaTodo.get(dk)
        if (l) l.push(ev); else diaTodo.set(dk, [ev])
      } else {
        const key = `${dk}#${horaSP(ev.inicio)}`
        const l = cronologico.get(key)
        if (l) l.push(ev); else cronologico.set(key, [ev])
      }
    }
    for (const l of diaTodo.values()) l.sort(ordenar)
    for (const l of cronologico.values()) l.sort(ordenar)
    return { diaTodo, cronologico }
  }, [eventos])

  function alternar(k: string) {
    setExpandidos(prev => {
      const prox = new Set(prev)
      if (prox.has(k)) prox.delete(k); else prox.add(k)
      return prox
    })
  }

  const colTemplate = 'grid-cols-[3.5rem_repeat(7,minmax(0,1fr))]'

  return (
    <div className="flex h-full min-h-0 flex-col rounded-xl border border-border bg-card">
      {/* Cabeçalho dos dias */}
      <div className={cn('grid border-b border-border', colTemplate)}>
        <div className="border-r border-border" />
        {dias.map((diaIso, i) => {
          const k = chaveDia(diaIso)
          const isHoje = k === hojeKey
          return (
            <div key={k} className="flex flex-col items-center gap-0.5 border-r border-border py-2">
              <span className="text-[11px] font-medium uppercase text-muted-foreground">{DIAS_SEMANA[i]}</span>
              <span
                className={cn(
                  'inline-flex h-7 min-w-7 items-center justify-center rounded-full text-sm',
                  isHoje ? 'bg-primary font-bold text-primary-foreground' : 'font-medium text-foreground',
                )}
              >
                {Number(k.slice(8, 10))}
              </span>
            </div>
          )
        })}
      </div>

      {/* Faixa "Dia todo" */}
      <div className={cn('grid border-b border-border', colTemplate)}>
        <div className="flex items-center justify-end border-r border-border px-2 py-1 text-[11px] font-medium text-muted-foreground">
          Dia todo
        </div>
        {dias.map(diaIso => {
          const k = chaveDia(diaIso)
          const lista = diaTodo.get(k) ?? []
          return (
            <div key={k} className="flex min-h-[2.25rem] flex-col gap-0.5 border-r border-border p-1">
              {lista.map(ev => (
                <ItemAgenda key={ev.id} evento={ev} meUserId={meUserId} onClick={onItemClick} />
              ))}
            </div>
          )
        })}
      </div>

      {/* Grade de horas */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {linhas.map(h => (
          <div key={h} className={cn('grid', colTemplate)}>
            <div className="border-r border-b border-border px-2 py-1 text-right text-[11px] tabular-nums text-muted-foreground">
              {String(h).padStart(2, '0')}:00
            </div>
            {dias.map(diaIso => {
              const dk = chaveDia(diaIso)
              const key = `${dk}#${h}`
              const lista = cronologico.get(key) ?? []
              const aberto = expandidos.has(key)
              const visiveis = aberto ? lista : lista.slice(0, MAX_CELULA)
              const restantes = lista.length - visiveis.length
              return (
                <div key={dk} className="flex min-h-[3rem] flex-col gap-0.5 border-r border-b border-border p-0.5">
                  {visiveis.map(ev => (
                    <ItemAgenda key={ev.id} evento={ev} meUserId={meUserId} onClick={onItemClick} mostrarHora />
                  ))}
                  {restantes > 0 && (
                    <button
                      type="button"
                      onClick={() => alternar(key)}
                      className="rounded px-1 py-0.5 text-left text-[11px] font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
                    >
                      + mais {restantes}
                    </button>
                  )}
                  {aberto && lista.length > MAX_CELULA && (
                    <button
                      type="button"
                      onClick={() => alternar(key)}
                      className="rounded px-1 py-0.5 text-left text-[11px] font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
                    >
                      ver menos
                    </button>
                  )}
                </div>
              )
            })}
          </div>
        ))}
      </div>
    </div>
  )
}
