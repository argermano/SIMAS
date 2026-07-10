'use client'

// Cabeçalho editorial + toolbar da agenda (redesign do mock):
// linha 1: eyebrow + título serifado "Agenda." + subtítulo | Hoje, ‹ período ›, + Novo evento;
// linha 2: segmented Dia/Semana/Mês, busca, funil (PainelFiltros) e chips de tipo.

import { useState } from 'react'
import {
  Scale, ChevronLeft, ChevronRight, Plus, Search, X, Filter, Loader2,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { ThemeToggle } from '@/components/ui/ThemeToggle'
import type { FiltroAgenda, FonteAgenda, Vista, Pessoa } from '@/lib/agenda/tipos'
import { TIPO_META, ORDEM_CHIPS } from './tipoMeta'
import { fonteDisplay } from './fonteDisplay'
import { PainelFiltros } from './PainelFiltros'

const VISTAS: { valor: Vista; label: string }[] = [
  { valor: 'dia', label: 'Dia' },
  { valor: 'semana', label: 'Semana' },
  { valor: 'mes', label: 'Mês' },
]

interface BarraTopoProps {
  vista: Vista
  onVista: (v: Vista) => void
  rotulo: string
  filtro: FiltroAgenda
  pessoas: Pessoa[]
  onAplicarFiltro: (patch: Partial<FiltroAgenda>) => void
  onBusca: (q: string) => void
  onHoje: () => void
  onPrev: () => void
  onProx: () => void
  onNovo: () => void
  carregando?: boolean
}

export function BarraTopo({
  vista, onVista, rotulo, filtro, pessoas,
  onAplicarFiltro, onBusca,
  onHoje, onPrev, onProx, onNovo, carregando,
}: BarraTopoProps) {
  const [filtrosAbertos, setFiltrosAbertos] = useState(false)

  // Chips de tipo: `tipos` vazio = todos ativos (convenção do FiltroAgenda).
  const ativos: FonteAgenda[] = filtro.tipos.length ? filtro.tipos : ORDEM_CHIPS
  function alternarTipo(f: FonteAgenda) {
    const set = new Set(ativos)
    if (set.has(f)) set.delete(f)
    else set.add(f)
    const prox = ORDEM_CHIPS.filter(t => set.has(t))
    // Nenhum ou todos selecionados => sem restrição (todos ativos).
    onAplicarFiltro({ tipos: prox.length === 0 || prox.length === ORDEM_CHIPS.length ? [] : prox })
  }

  const filtrosAvancadosAtivos =
    filtro.status !== 'todas' || filtro.atribuicao.length > 0 ||
    filtro.pessoas.length > 0 || filtro.equipes.length > 0 || filtro.tags.length > 0

  return (
    <div className="border-b border-border bg-card px-4 pb-4 pt-5 sm:px-6 max-lg:pl-16">
      {/* Linha 1 — cabeçalho editorial + navegação de período */}
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
            <Scale className="h-3.5 w-3.5" aria-hidden />
            Escritório · Agenda
          </p>
          <h1 className={cn(fonteDisplay.className, 'mt-1 text-4xl font-semibold leading-tight text-foreground sm:text-5xl')}>
            Agenda<span className="text-accent">.</span>
          </h1>
          <p className="mt-2 max-w-xl text-sm text-muted-foreground">
            Reuniões, prazos processuais, audiências e tarefas dos advogados — unificados em uma única vista.
          </p>
        </div>

        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {carregando && (
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" aria-label="Carregando" />
          )}
          <button
            type="button"
            onClick={onHoje}
            className="rounded-full border border-border px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-muted"
          >
            Hoje
          </button>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={onPrev}
              aria-label="Período anterior"
              className="flex h-9 w-9 items-center justify-center rounded-full border border-border text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <span className="min-w-[9rem] text-center text-sm font-semibold capitalize text-foreground">
              {rotulo}
            </span>
            <button
              type="button"
              onClick={onProx}
              aria-label="Próximo período"
              className="flex h-9 w-9 items-center justify-center rounded-full border border-border text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
          <button
            type="button"
            onClick={onNovo}
            className="inline-flex items-center gap-1.5 rounded-full bg-foreground px-4 py-2 text-sm font-medium text-background transition-opacity hover:opacity-90"
          >
            <Plus className="h-4 w-4" /> Novo evento
          </button>
          <ThemeToggle />
        </div>
      </div>

      {/* Linha 2 — vista, busca, filtros avançados e chips de tipo */}
      <div className="mt-5 flex flex-wrap items-center gap-2">
        <div className="inline-flex items-center rounded-full border border-border p-1" role="group" aria-label="Vista">
          {VISTAS.map(v => (
            <button
              key={v.valor}
              type="button"
              onClick={() => onVista(v.valor)}
              aria-pressed={vista === v.valor}
              className={cn(
                'rounded-full px-4 py-1.5 text-sm font-medium transition-colors',
                vista === v.valor
                  ? 'bg-foreground text-background'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {v.label}
            </button>
          ))}
        </div>

        <div className="relative min-w-[12rem] flex-1">
          <div className="pointer-events-none absolute inset-y-0 left-3.5 flex items-center text-muted-foreground">
            <Search className="h-4 w-4" />
          </div>
          <input
            type="search"
            value={filtro.q}
            onChange={e => onBusca(e.target.value)}
            placeholder="Buscar por parte, processo, advogado..."
            aria-label="Buscar na agenda"
            className="h-10 w-full rounded-full border border-input bg-background pl-10 pr-9 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          {filtro.q && (
            <button
              type="button"
              onClick={() => onBusca('')}
              aria-label="Limpar busca"
              className="absolute inset-y-0 right-3 flex items-center text-muted-foreground hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>

        <div className="relative">
          <button
            type="button"
            onClick={() => setFiltrosAbertos(v => !v)}
            aria-label="Filtros avançados"
            aria-expanded={filtrosAbertos}
            className={cn(
              'relative flex h-10 w-10 items-center justify-center rounded-full border border-border transition-colors',
              filtrosAbertos || filtrosAvancadosAtivos
                ? 'bg-muted text-foreground'
                : 'text-muted-foreground hover:bg-muted hover:text-foreground',
            )}
          >
            <Filter className="h-4 w-4" />
            {filtrosAvancadosAtivos && (
              <span className="absolute right-1 top-1 h-2 w-2 rounded-full bg-accent" aria-hidden />
            )}
          </button>
          <PainelFiltros
            aberto={filtrosAbertos}
            value={filtro}
            pessoas={pessoas}
            onAplicar={onAplicarFiltro}
            onFechar={() => setFiltrosAbertos(false)}
          />
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          {ORDEM_CHIPS.map(f => {
            const meta = TIPO_META[f]
            const ativo = ativos.includes(f)
            return (
              <button
                key={f}
                type="button"
                onClick={() => alternarTipo(f)}
                aria-pressed={ativo}
                className={cn(
                  'inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors',
                  ativo
                    ? cn('border-transparent', meta.pill)
                    : 'border-border text-muted-foreground hover:bg-muted/50',
                )}
              >
                <span
                  className={cn('h-2 w-2 rounded-full', ativo ? meta.dot : 'bg-muted-foreground/40')}
                  aria-hidden
                />
                {meta.rotulo}
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}
