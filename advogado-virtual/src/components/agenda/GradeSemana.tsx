'use client'

// Vista de semana (redesign): faixa de cabeçalho creme Dom..Sáb com hoje em
// círculo escuro, faixa "Dia todo" e grade de horas com pílulas pastel.
// Clique na área das células seleciona o dia (highlight sutil na coluna).

import { useMemo, useState } from 'react'
import { cn } from '@/lib/utils'
import { diasDaSemana, chaveDia, horas } from '@/lib/agenda/grade'
import type { EventoCalendario } from '@/lib/agenda/tipos'
import { ItemAgenda, horaSP } from './ItemAgenda'

const DIAS_SEMANA = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb']
const MAX_CELULA = 3
// A equipe usa quase tudo como TAREFA "dia todo" (nasce da publicação): a faixa
// empilha muitos itens por dia, então limitamos e oferecemos "mais N" p/ expandir.
const MAX_DIATODO = 3

interface GradeSemanaProps {
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

export function GradeSemana({
  dataRef,
  eventos,
  meUserId,
  onItemClick,
  onSelecionarDia,
  diaSelecionado,
}: GradeSemanaProps) {
  const [expandidos, setExpandidos] = useState<Set<string>>(new Set())

  const dias = useMemo(() => diasDaSemana(dataRef), [dataRef])
  const linhas = useMemo(() => horas(), [])
  const hojeKey = useMemo(() => chaveDia(new Date().toISOString()), [])
  const selKey = useMemo(() => (diaSelecionado ? chaveDia(diaSelecionado) : null), [diaSelecionado])

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
    <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-xl border border-border bg-card">
      {/* Em telas pequenas a grade rola horizontalmente dentro do card
          (cabeçalho, "Dia todo" e horas no mesmo scroller para alinhar). */}
      <div className="min-h-0 flex-1 overflow-x-auto">
        <div className="flex h-full min-h-0 min-w-[42rem] flex-col md:min-w-0">
          {/* Faixa creme com os dias */}
          <div className={cn('grid rounded-t-xl border-b border-border bg-muted/60 dark:bg-muted/30', colTemplate)}>
            <div className="border-r border-border" />
            {dias.map((diaIso, i) => {
              const k = chaveDia(diaIso)
              const isHoje = k === hojeKey
              const selecionado = k === selKey
              return (
                <div
                  key={k}
                  role="button"
                  tabIndex={0}
                  aria-pressed={selecionado}
                  onClick={() => onSelecionarDia?.(diaIso)}
                  onKeyDown={e => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault()
                      onSelecionarDia?.(diaIso)
                    }
                  }}
                  className={cn(
                    'flex cursor-pointer flex-col items-center gap-0.5 border-r border-border py-2 transition-colors hover:bg-muted/40',
                    selecionado && 'bg-primary/5 ring-1 ring-inset ring-primary/50',
                  )}
                >
                  <span className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
                    {DIAS_SEMANA[i]}
                  </span>
                  <span
                    className={cn(
                      'inline-flex h-7 min-w-7 items-center justify-center rounded-full text-sm',
                      isHoje
                        ? 'w-7 bg-foreground font-semibold text-background'
                        : 'font-medium text-foreground',
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
              const selecionado = k === selKey
              const chaveExp = `allday#${k}`
              const aberto = expandidos.has(chaveExp)
              const visiveis = aberto ? lista : lista.slice(0, MAX_DIATODO)
              const restantes = lista.length - visiveis.length
              return (
                <div
                  key={k}
                  onClick={() => onSelecionarDia?.(diaIso)}
                  className={cn(
                    'flex min-h-[2.25rem] cursor-pointer flex-col gap-0.5 border-r border-border p-1 transition-colors hover:bg-muted/20',
                    selecionado && 'bg-primary/5',
                  )}
                >
                  {visiveis.map(ev => (
                    <ItemAgenda key={ev.id} evento={ev} meUserId={meUserId} onClick={onItemClick} />
                  ))}
                  {restantes > 0 && (
                    <button
                      type="button"
                      onClick={e => {
                        e.stopPropagation()
                        alternar(chaveExp)
                      }}
                      className="rounded px-1 py-0.5 text-left text-[11px] font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
                    >
                      mais {restantes}
                    </button>
                  )}
                  {aberto && lista.length > MAX_DIATODO && (
                    <button
                      type="button"
                      onClick={e => {
                        e.stopPropagation()
                        alternar(chaveExp)
                      }}
                      className="rounded px-1 py-0.5 text-left text-[11px] font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
                    >
                      ver menos
                    </button>
                  )}
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
                  const selecionado = dk === selKey
                  return (
                    <div
                      key={dk}
                      onClick={() => onSelecionarDia?.(diaIso)}
                      className={cn(
                        'flex min-h-[3rem] cursor-pointer flex-col gap-0.5 border-r border-b border-border p-0.5 transition-colors hover:bg-muted/20',
                        selecionado && 'bg-primary/5',
                      )}
                    >
                      {visiveis.map(ev => (
                        <ItemAgenda key={ev.id} evento={ev} meUserId={meUserId} onClick={onItemClick} mostrarHora />
                      ))}
                      {restantes > 0 && (
                        <button
                          type="button"
                          onClick={e => {
                            e.stopPropagation()
                            alternar(key)
                          }}
                          className="rounded px-1 py-0.5 text-left text-[11px] font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
                        >
                          mais {restantes}
                        </button>
                      )}
                      {aberto && lista.length > MAX_CELULA && (
                        <button
                          type="button"
                          onClick={e => {
                            e.stopPropagation()
                            alternar(key)
                          }}
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
      </div>
    </div>
  )
}
