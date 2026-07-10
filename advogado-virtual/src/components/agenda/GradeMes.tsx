'use client'

// Vista de mês (redesign): faixa creme Dom..Sáb, células altas com número
// sup-esq + contador sup-dir, hoje em círculo escuro, pílulas pastel com
// ícone do tipo, "mais N", e seleção de dia (clique na célula).

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
  /** Clique na área da célula seleciona o dia (ISO início de dia). */
  onSelecionarDia?: (diaISO: string) => void
  /** Dia selecionado (ISO início de dia) — highlight sutil. */
  diaSelecionado?: string | null
}

function ordenar(a: EventoCalendario, b: EventoCalendario): number {
  if (a.diaTodo !== b.diaTodo) return a.diaTodo ? -1 : 1
  return a.inicio.localeCompare(b.inicio)
}

export function GradeMes({
  dataRef,
  eventos,
  meUserId,
  onItemClick,
  onSelecionarDia,
  diaSelecionado,
}: GradeMesProps) {
  const [expandidos, setExpandidos] = useState<Set<string>>(new Set())

  const semanas = useMemo(() => semanasDoMes(dataRef), [dataRef])
  const mesRef = useMemo(() => chaveDia(dataRef).slice(0, 7), [dataRef])
  const hojeKey = useMemo(() => chaveDia(new Date().toISOString()), [])
  const selKey = useMemo(() => (diaSelecionado ? chaveDia(diaSelecionado) : null), [diaSelecionado])

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
    <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-xl border border-border bg-card">
      {/* Em telas pequenas a grade rola horizontalmente dentro do card
          (cabeçalho e corpo no mesmo scroller para as colunas alinharem). */}
      <div className="min-h-0 flex-1 overflow-x-auto">
        <div className="flex h-full min-h-0 min-w-[36rem] flex-col md:min-w-0">
          {/* Faixa creme com os dias da semana */}
          <div className="grid grid-cols-7 rounded-t-xl border-b border-border bg-muted/60 dark:bg-muted/30">
            {DIAS_SEMANA.map(d => (
              <div
                key={d}
                className="px-2 py-2.5 text-center text-[11px] font-semibold uppercase tracking-widest text-muted-foreground"
              >
                {d}
              </div>
            ))}
          </div>

          {/* Semanas */}
          <div className="min-h-0 flex-1 overflow-y-auto">
            <div
              className="grid min-h-full"
              style={{ gridTemplateRows: `repeat(${semanas.length}, minmax(110px, 1fr))` }}
            >
              {semanas.map((semana, i) => (
                <div key={i} className="grid grid-cols-7">
                  {semana.map(diaIso => {
                    const k = chaveDia(diaIso)
                    const doMes = k.slice(0, 7) === mesRef
                    const isHoje = k === hojeKey
                    const selecionado = k === selKey
                    const numero = Number(k.slice(8, 10))
                    const lista = porDia.get(k) ?? []
                    const aberto = expandidos.has(k)
                    const visiveis = aberto ? lista : lista.slice(0, MAX_VISIVEL)
                    const restantes = lista.length - visiveis.length

                    return (
                      <div
                        key={k}
                        onClick={() => onSelecionarDia?.(diaIso)}
                        className={cn(
                          'flex min-h-[110px] cursor-pointer flex-col gap-1 overflow-hidden border-b border-r border-border p-1.5 transition-colors',
                          doMes ? 'hover:bg-muted/20' : 'bg-muted/30 hover:bg-muted/40',
                          selecionado && 'bg-primary/5 ring-1 ring-inset ring-primary/50',
                        )}
                      >
                        <div className="flex items-start justify-between px-0.5">
                          <button
                            type="button"
                            aria-label={`Selecionar dia ${k}`}
                            aria-pressed={selecionado}
                            onClick={e => {
                              e.stopPropagation()
                              onSelecionarDia?.(diaIso)
                            }}
                            className={cn(
                              'inline-flex items-center justify-center text-xs',
                              isHoje &&
                                'h-7 w-7 rounded-full bg-foreground font-semibold text-background',
                              !isHoje && doMes && 'h-7 min-w-7 font-medium text-foreground',
                              !isHoje && !doMes && 'h-7 min-w-7 text-muted-foreground',
                            )}
                          >
                            {numero}
                          </button>
                          {lista.length > 0 && (
                            <span className="pt-1 text-[11px] tabular-nums text-muted-foreground">
                              {lista.length}
                            </span>
                          )}
                        </div>

                        <div className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto">
                          {visiveis.map(ev => (
                            <ItemAgenda key={ev.id} evento={ev} meUserId={meUserId} onClick={onItemClick} />
                          ))}
                          {restantes > 0 && (
                            <button
                              type="button"
                              onClick={e => {
                                e.stopPropagation()
                                alternar(k)
                              }}
                              className="rounded px-1.5 py-0.5 text-left text-[11px] font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
                            >
                              mais {restantes}
                            </button>
                          )}
                          {aberto && lista.length > MAX_VISIVEL && (
                            <button
                              type="button"
                              onClick={e => {
                                e.stopPropagation()
                                alternar(k)
                              }}
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
        </div>
      </div>
    </div>
  )
}
