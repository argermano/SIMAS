'use client'

// Card "Selecione um dia" da coluna direita da /agenda (redesign).
// Sem dia selecionado: instrução. Com dia: data por extenso + itens do dia.

import { CalendarDays, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { EventoCalendario } from '@/lib/agenda/tipos'
import { mesmoDia, chaveDia } from '@/lib/agenda/grade'
import { ROTULO_UNIDADE, type UnidadePresenca } from '@/lib/agenda/presenca'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { TIPO_META } from './tipoMeta'

const TZ = 'America/Sao_Paulo'

const _fmtExtenso = new Intl.DateTimeFormat('pt-BR', {
  timeZone: TZ,
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  year: 'numeric',
})

const _fmtHora = new Intl.DateTimeFormat('pt-BR', {
  timeZone: TZ,
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
})

/** "quarta-feira, 15 de julho de 2026" com a inicial maiúscula. */
function dataExtenso(iso: string): string {
  const s = _fmtExtenso.format(new Date(iso))
  return s.charAt(0).toUpperCase() + s.slice(1)
}

interface PainelDiaProps {
  /** ISO do início do dia selecionado (SP), ou null se nenhum. */
  dia: string | null
  /** Todos os eventos do intervalo carregado, já filtrados. */
  eventos: EventoCalendario[]
  onAbrir: (ev: EventoCalendario) => void
  onLimpar: () => void
  /** Presenças no intervalo (com nome resolvido) — chip "📍 <nome> em <unidade>". */
  presencas?: { data: string; unidade: UnidadePresenca; nome: string }[]
}

export function PainelDia({ dia, eventos, onAbrir, onLimpar, presencas }: PainelDiaProps) {
  const presencasDoDia = dia
    ? (presencas ?? []).filter((p) => p.data.slice(0, 10) === chaveDia(dia))
    : []
  const doDia = dia
    ? eventos
        .filter((ev) => mesmoDia(ev.inicio, dia))
        .sort(
          (a, b) =>
            Number(b.diaTodo) - Number(a.diaTodo) || a.inicio.localeCompare(b.inicio),
        )
    : []

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0">
        <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
          <CalendarDays className="h-3.5 w-3.5" aria-hidden />
          Selecione um dia
        </p>
        {dia && (
          <button
            type="button"
            onClick={onLimpar}
            aria-label="Limpar dia selecionado"
            className="rounded-full p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        )}
      </CardHeader>

      <CardContent>
        {!dia ? (
          <p className="text-sm text-muted-foreground">
            Toque em qualquer dia do calendário para ver os detalhes aqui.
          </p>
        ) : (
          <div className="space-y-3">
            <p className="text-sm font-semibold text-card-foreground">
              {dataExtenso(dia)}
            </p>

            {presencasDoDia.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {presencasDoDia.map((p) => (
                  <span
                    key={`${p.data}-${p.nome}-${p.unidade}`}
                    className="inline-flex items-center gap-1 rounded-full border border-accent/30 bg-accent/10 px-2.5 py-1 text-xs font-medium text-foreground"
                  >
                    <span aria-hidden>📍</span>
                    {p.nome} em {ROTULO_UNIDADE[p.unidade]}
                  </span>
                ))}
              </div>
            )}

            {doDia.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nenhum item neste dia.</p>
            ) : (
              <ul className="space-y-1">
                {doDia.map((ev) => {
                  const meta = TIPO_META[ev.fonte]
                  const encerrado = ev.status === 'concluida' || ev.status === 'cancelada'
                  return (
                    <li key={ev.id}>
                      <button
                        type="button"
                        onClick={() => onAbrir(ev)}
                        title={ev.titulo}
                        className="group flex w-full items-start gap-2.5 rounded-lg px-2 py-2 text-left transition-colors hover:bg-muted/60"
                      >
                        <span
                          className={cn('mt-1.5 h-2 w-2 shrink-0 rounded-full', meta.dot)}
                          aria-hidden
                        />
                        <span className="min-w-0 flex-1">
                          <span
                            className={cn(
                              'block text-[10px] font-semibold uppercase tracking-widest',
                              meta.texto,
                            )}
                          >
                            {meta.rotulo}
                          </span>
                          <span
                            className={cn(
                              'block truncate text-sm font-medium text-card-foreground',
                              encerrado && 'text-muted-foreground line-through opacity-70',
                            )}
                          >
                            {ev.titulo}
                          </span>
                          {(!ev.diaTodo || ev.responsavel) && (
                            <span className="block truncate text-xs text-muted-foreground">
                              {[
                                ev.diaTodo ? null : _fmtHora.format(new Date(ev.inicio)),
                                ev.responsavel?.nome ?? null,
                              ]
                                .filter(Boolean)
                                .join(' · ')}
                            </span>
                          )}
                        </span>
                      </button>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
