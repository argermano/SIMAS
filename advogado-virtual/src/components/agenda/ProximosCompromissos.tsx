'use client'

// Card "Próximos compromissos" da coluna direita da /agenda (redesign).
// Lista os próximos itens (início >= agora) do intervalo carregado, asc, máx. 8.

import { Bell } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { EventoCalendario } from '@/lib/agenda/tipos'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { TIPO_META } from './tipoMeta'

const TZ = 'America/Sao_Paulo'
const MAX_ITENS = 8

const _fmtHora = new Intl.DateTimeFormat('pt-BR', {
  timeZone: TZ,
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
})

const _fmtMesAbrev = new Intl.DateTimeFormat('pt-BR', { timeZone: TZ, month: 'short' })
const _fmtDiaNum = new Intl.DateTimeFormat('pt-BR', { timeZone: TZ, day: 'numeric' })

/** "JUL" a partir de um ISO (pt-BR abrevia com ponto: "jul." → "JUL"). */
function mesAbrev(iso: string): string {
  return _fmtMesAbrev.format(new Date(iso)).replace(/\./g, '').toUpperCase()
}

interface ProximosCompromissosProps {
  /** Todos os eventos do intervalo carregado, já filtrados. */
  eventos: EventoCalendario[]
  onAbrir: (ev: EventoCalendario) => void
}

export function ProximosCompromissos({ eventos, onAbrir }: ProximosCompromissosProps) {
  const agora = Date.now()
  const proximos = eventos
    .filter((ev) => new Date(ev.inicio).getTime() >= agora)
    .sort((a, b) => a.inicio.localeCompare(b.inicio))
    .slice(0, MAX_ITENS)

  return (
    <Card>
      <CardHeader>
        <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
          <Bell className="h-3.5 w-3.5" aria-hidden />
          Próximos compromissos
        </p>
      </CardHeader>

      <CardContent>
        {proximos.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Nenhum compromisso próximo neste período.
          </p>
        ) : (
          <ul className="space-y-1">
            {proximos.map((ev) => {
              const meta = TIPO_META[ev.fonte]
              const encerrado = ev.status === 'concluida' || ev.status === 'cancelada'
              const linha = [
                ev.diaTodo ? null : _fmtHora.format(new Date(ev.inicio)),
                ev.responsavel?.nome ?? null,
              ]
                .filter(Boolean)
                .join(' · ')
              return (
                <li key={ev.id}>
                  <button
                    type="button"
                    onClick={() => onAbrir(ev)}
                    title={ev.titulo}
                    className="group flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left transition-colors hover:bg-muted/60"
                  >
                    <span
                      className="flex h-11 w-11 shrink-0 flex-col items-center justify-center rounded-lg bg-muted"
                      aria-hidden
                    >
                      <span className="text-[9px] font-semibold uppercase tracking-widest text-muted-foreground">
                        {mesAbrev(ev.inicio)}
                      </span>
                      <span className="text-sm font-bold leading-none text-foreground">
                        {_fmtDiaNum.format(new Date(ev.inicio))}
                      </span>
                    </span>

                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-1.5">
                        <span
                          className={cn('h-1.5 w-1.5 shrink-0 rounded-full', meta.dot)}
                          aria-hidden
                        />
                        <span
                          className={cn(
                            'text-[10px] font-semibold uppercase tracking-widest',
                            meta.texto,
                          )}
                        >
                          {meta.rotulo}
                        </span>
                      </span>
                      <span
                        className={cn(
                          'block truncate text-sm font-semibold text-card-foreground',
                          encerrado && 'text-muted-foreground line-through opacity-70',
                        )}
                      >
                        {ev.titulo}
                      </span>
                      {linha && (
                        <span className="block truncate text-xs text-muted-foreground">
                          {linha}
                        </span>
                      )}
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}
