'use client'

import * as React from 'react'
import { Check, ChevronDown, ListFilter } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import type { FiltroAgenda, FonteAgenda, StatusItem } from '@/lib/agenda/tipos'

interface FiltroAtividadesProps {
  value: FiltroAgenda
  onAplicar: (patch: Partial<FiltroAgenda>) => void
}

const TIPOS: { valor: FonteAgenda; label: string }[] = [
  { valor: 'tarefa', label: 'Tarefas' },
  { valor: 'evento', label: 'Eventos' },
  { valor: 'prazo', label: 'Prazos' },
  { valor: 'audiencia', label: 'Audiências' },
  { valor: 'consulta', label: 'Consultas' },
]

const STATUS: { valor: StatusItem | 'todas'; label: string }[] = [
  { valor: 'a_concluir', label: 'A concluir' },
  { valor: 'concluida', label: 'Concluídas' },
  { valor: 'cancelada', label: 'Canceladas' },
  { valor: 'todas', label: 'Todas' },
]

function LinhaCheck({
  marcado,
  redondo,
  onToggle,
  children,
}: {
  marcado: boolean
  redondo?: boolean
  onToggle: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted transition-colors"
    >
      <span
        className={cn(
          'flex h-4 w-4 shrink-0 items-center justify-center border transition-colors',
          redondo ? 'rounded-full' : 'rounded',
          marcado ? 'border-primary bg-primary text-primary-foreground' : 'border-input'
        )}
        aria-hidden
      >
        {marcado && (redondo ? <span className="h-1.5 w-1.5 rounded-full bg-current" /> : <Check className="h-3 w-3" />)}
      </span>
      <span className="flex-1 truncate">{children}</span>
    </button>
  )
}

export function FiltroAtividades({ value, onAplicar }: FiltroAtividadesProps) {
  const [aberto, setAberto] = React.useState(false)
  const [tipos, setTipos] = React.useState<FonteAgenda[]>(value.tipos)
  const [status, setStatus] = React.useState<StatusItem | 'todas'>(value.status)
  const ref = React.useRef<HTMLDivElement>(null)

  React.useEffect(() => {
    if (aberto) {
      setTipos(value.tipos)
      setStatus(value.status)
    }
  }, [aberto, value.tipos, value.status])

  React.useEffect(() => {
    if (!aberto) return
    function onDoc(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setAberto(false)
    }
    function onEsc(e: KeyboardEvent) {
      if (e.key === 'Escape') setAberto(false)
    }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onEsc)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onEsc)
    }
  }, [aberto])

  function toggleTipo(t: FonteAgenda) {
    setTipos(prev => (prev.includes(t) ? prev.filter(x => x !== t) : [...prev, t]))
  }

  function aplicar() {
    onAplicar({ tipos, status })
    setAberto(false)
  }

  const ativo = value.tipos.length > 0 || value.status !== 'todas'

  return (
    <div className="relative" ref={ref}>
      <Button
        type="button"
        variant="secondary"
        size="sm"
        onClick={() => setAberto(a => !a)}
        className={cn(ativo && 'border-primary text-primary')}
      >
        <ListFilter className="h-4 w-4" />
        Todas as atividades
        <ChevronDown className="h-4 w-4" />
      </Button>

      {aberto && (
        <div className="absolute left-0 z-40 mt-2 w-64 rounded-lg border border-border bg-card p-4 shadow-lg">
          <div className="space-y-4">
            <section>
              <p className="mb-1 px-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Exibir
              </p>
              {TIPOS.map(t => (
                <LinhaCheck
                  key={t.valor}
                  marcado={tipos.includes(t.valor)}
                  onToggle={() => toggleTipo(t.valor)}
                >
                  {t.label}
                </LinhaCheck>
              ))}
            </section>

            <section>
              <p className="mb-1 px-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Status
              </p>
              {STATUS.map(s => (
                <LinhaCheck
                  key={s.valor}
                  redondo
                  marcado={status === s.valor}
                  onToggle={() => setStatus(s.valor)}
                >
                  {s.label}
                </LinhaCheck>
              ))}
            </section>
          </div>

          <div className="mt-4 flex justify-end gap-2 border-t border-border pt-3">
            <Button type="button" variant="ghost" size="sm" onClick={() => setAberto(false)}>
              Cancelar
            </Button>
            <Button type="button" variant="default" size="sm" onClick={aplicar}>
              Aplicar
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
