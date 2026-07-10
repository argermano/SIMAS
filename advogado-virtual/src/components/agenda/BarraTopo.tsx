'use client'

// Barra de topo da agenda: seletor de vista, filtros (componentes do outro agente),
// busca, navegação de período e ação de criar.

import { ChevronLeft, ChevronRight, RotateCw, Plus } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import type { FiltroAgenda, Vista, Pessoa } from '@/lib/agenda/tipos'
import { FiltroAtribuicao } from './FiltroAtribuicao'
import { FiltroAtividades } from './FiltroAtividades'
import { FiltroTags } from './FiltroTags'
import { BuscaAgenda } from './BuscaAgenda'

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
  onAplicarTags: (tags: string[]) => void
  onBusca: (q: string) => void
  onHoje: () => void
  onPrev: () => void
  onProx: () => void
  onAtualizar: () => void
  onNovo: () => void
  carregando?: boolean
}

export function BarraTopo({
  vista, onVista, rotulo, filtro, pessoas,
  onAplicarFiltro, onAplicarTags, onBusca,
  onHoje, onPrev, onProx, onAtualizar, onNovo, carregando,
}: BarraTopoProps) {
  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-border bg-card px-4 py-3">
      {/* Seletor de vista */}
      <div className="inline-flex rounded-lg border border-border p-0.5">
        {VISTAS.map(v => (
          <button
            key={v.valor}
            type="button"
            onClick={() => onVista(v.valor)}
            className={cn(
              'rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
              vista === v.valor
                ? 'bg-primary text-primary-foreground'
                : 'text-muted-foreground hover:bg-muted hover:text-foreground',
            )}
            aria-pressed={vista === v.valor}
          >
            {v.label}
          </button>
        ))}
      </div>

      {/* Filtros do outro agente (contratos pinados) */}
      <FiltroAtribuicao value={filtro} pessoas={pessoas} onAplicar={onAplicarFiltro} />
      <FiltroAtividades value={filtro} onAplicar={onAplicarFiltro} />
      <FiltroTags value={filtro.tags} onAplicar={onAplicarTags} />

      <div className="min-w-[10rem] flex-1">
        <BuscaAgenda value={filtro.q} onChange={onBusca} />
      </div>

      {/* Navegação de período */}
      <Button variant="secondary" size="sm" onClick={onHoje}>Hoje</Button>
      <div className="inline-flex items-center gap-1">
        <button
          type="button"
          onClick={onPrev}
          aria-label="Período anterior"
          className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={onProx}
          aria-label="Próximo período"
          className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>
      <span className="min-w-[9rem] text-sm font-semibold capitalize text-foreground">{rotulo}</span>

      <button
        type="button"
        onClick={onAtualizar}
        aria-label="Atualizar"
        title="Atualizar"
        className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
      >
        <RotateCw className={cn('h-4 w-4', carregando && 'animate-spin')} />
      </button>

      <Button size="sm" onClick={onNovo}>
        <Plus className="h-4 w-4" /> Novo
      </Button>
    </div>
  )
}
