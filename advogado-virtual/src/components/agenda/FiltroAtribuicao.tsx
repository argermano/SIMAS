'use client'

import * as React from 'react'
import { Check, ChevronDown, Users } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import type { Atribuicao, FiltroAgenda, Pessoa, Visibilidade } from '@/lib/agenda/tipos'

interface FiltroAtribuicaoProps {
  value: FiltroAgenda
  pessoas: Pessoa[]
  onAplicar: (patch: Partial<FiltroAgenda>) => void
}

const ATRIBUICOES: { valor: Atribuicao; label: string }[] = [
  { valor: 'responsavel', label: 'Responsáveis' },
  { valor: 'envolvido', label: 'Envolvidos' },
  { valor: 'criador', label: 'Quem criou' },
]

const EQUIPES: { valor: Visibilidade; label: string }[] = [
  { valor: 'escritorio', label: 'Escritório' },
  { valor: 'particular', label: 'Particular' },
]

function LinhaCheck({
  marcado,
  onToggle,
  children,
}: {
  marcado: boolean
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
          'flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-colors',
          marcado ? 'border-primary bg-primary text-primary-foreground' : 'border-input'
        )}
        aria-hidden
      >
        {marcado && <Check className="h-3 w-3" />}
      </span>
      <span className="flex-1 truncate">{children}</span>
    </button>
  )
}

export function FiltroAtribuicao({ value, pessoas, onAplicar }: FiltroAtribuicaoProps) {
  const [aberto, setAberto] = React.useState(false)
  const [atribuicao, setAtribuicao] = React.useState<Atribuicao[]>(value.atribuicao)
  const [selPessoas, setSelPessoas] = React.useState<string[]>(value.pessoas)
  const [equipes, setEquipes] = React.useState<Visibilidade[]>(value.equipes)
  const ref = React.useRef<HTMLDivElement>(null)

  // Ao abrir, sincroniza o rascunho com o filtro atual.
  React.useEffect(() => {
    if (aberto) {
      setAtribuicao(value.atribuicao)
      setSelPessoas(value.pessoas)
      setEquipes(value.equipes)
    }
  }, [aberto, value.atribuicao, value.pessoas, value.equipes])

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

  function toggle<T>(lista: T[], set: (v: T[]) => void, item: T) {
    set(lista.includes(item) ? lista.filter(x => x !== item) : [...lista, item])
  }

  const todasMarcadas = pessoas.length > 0 && selPessoas.length === pessoas.length

  function toggleTodasPessoas() {
    setSelPessoas(todasMarcadas ? [] : pessoas.map(p => p.id))
  }

  function aplicar() {
    onAplicar({ atribuicao, pessoas: selPessoas, equipes })
    setAberto(false)
  }

  const ativo =
    value.atribuicao.length > 0 || value.pessoas.length > 0 || value.equipes.length > 0

  return (
    <div className="relative" ref={ref}>
      <Button
        type="button"
        variant="secondary"
        size="sm"
        onClick={() => setAberto(a => !a)}
        className={cn(ativo && 'border-primary text-primary')}
      >
        <Users className="h-4 w-4" />
        Minhas atribuições
        <ChevronDown className="h-4 w-4" />
      </Button>

      {aberto && (
        <div className="absolute left-0 z-40 mt-2 w-72 rounded-lg border border-border bg-card p-4 shadow-lg">
          <div className="max-h-[60vh] space-y-4 overflow-y-auto">
            <section>
              <p className="mb-1 px-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Atribuição
              </p>
              {ATRIBUICOES.map(a => (
                <LinhaCheck
                  key={a.valor}
                  marcado={atribuicao.includes(a.valor)}
                  onToggle={() => toggle(atribuicao, setAtribuicao, a.valor)}
                >
                  {a.label}
                </LinhaCheck>
              ))}
            </section>

            <section>
              <div className="mb-1 flex items-center justify-between px-2">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Pessoas
                </p>
                {pessoas.length > 0 && (
                  <button
                    type="button"
                    onClick={toggleTodasPessoas}
                    className="text-xs font-medium text-primary hover:underline"
                  >
                    {todasMarcadas ? 'Limpar' : 'Marcar todas'}
                  </button>
                )}
              </div>
              {pessoas.length === 0 ? (
                <p className="px-2 py-1.5 text-sm text-muted-foreground">Sem pessoas</p>
              ) : (
                pessoas.map(p => (
                  <LinhaCheck
                    key={p.id}
                    marcado={selPessoas.includes(p.id)}
                    onToggle={() => toggle(selPessoas, setSelPessoas, p.id)}
                  >
                    {p.nome}
                  </LinhaCheck>
                ))
              )}
            </section>

            <section>
              <p className="mb-1 px-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Equipes
              </p>
              {EQUIPES.map(e => (
                <LinhaCheck
                  key={e.valor}
                  marcado={equipes.includes(e.valor)}
                  onToggle={() => toggle(equipes, setEquipes, e.valor)}
                >
                  {e.label}
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
