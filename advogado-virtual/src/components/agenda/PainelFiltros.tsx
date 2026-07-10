'use client'

import * as React from 'react'
import { Check, SlidersHorizontal, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import type {
  Atribuicao,
  FiltroAgenda,
  Pessoa,
  StatusItem,
  Visibilidade,
} from '@/lib/agenda/tipos'

/**
 * Painel único de filtros avançados da agenda (popover do botão-funil).
 *
 * Controlado pelo shell: `aberto` decide a renderização; `onFechar` fecha
 * (Esc, clique fora, Cancelar, X); `onAplicar(patch)` entrega o rascunho.
 * Os CHIPS de tipo ficam FORA deste painel (toolbar do shell).
 *
 * Posicionamento: renderize dentro de um contêiner `relative` junto ao
 * botão-gatilho — em sm+ o painel abre em `absolute right-0 top-full`;
 * em telas pequenas ele é `fixed` à viewport para não ser cortado.
 */
interface PainelFiltrosProps {
  aberto: boolean
  value: FiltroAgenda
  pessoas: Pessoa[]
  onAplicar: (patch: Partial<FiltroAgenda>) => void
  onFechar: () => void
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

const STATUS: { valor: StatusItem | 'todas'; label: string }[] = [
  { valor: 'a_concluir', label: 'A concluir' },
  { valor: 'concluida', label: 'Concluídas' },
  { valor: 'cancelada', label: 'Canceladas' },
  { valor: 'todas', label: 'Todas' },
]

function Eyebrow({ children }: { children: React.ReactNode }) {
  return (
    <p className="mb-1.5 px-2 text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
      {children}
    </p>
  )
}

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
      role={redondo ? 'radio' : 'checkbox'}
      aria-checked={marcado}
      onClick={onToggle}
      className="flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left text-sm text-foreground transition-colors hover:bg-muted"
    >
      <span
        className={cn(
          'flex h-4 w-4 shrink-0 items-center justify-center border transition-colors',
          redondo ? 'rounded-full' : 'rounded',
          marcado
            ? 'border-foreground bg-foreground text-background'
            : 'border-input bg-background'
        )}
        aria-hidden
      >
        {marcado &&
          (redondo ? (
            <span className="h-1.5 w-1.5 rounded-full bg-current" />
          ) : (
            <Check className="h-3 w-3" />
          ))}
      </span>
      <span className="flex-1 truncate">{children}</span>
    </button>
  )
}

export function PainelFiltros({ aberto, value, pessoas, onAplicar, onFechar }: PainelFiltrosProps) {
  const [atribuicao, setAtribuicao] = React.useState<Atribuicao[]>(value.atribuicao)
  const [selPessoas, setSelPessoas] = React.useState<string[]>(value.pessoas)
  const [equipes, setEquipes] = React.useState<Visibilidade[]>(value.equipes)
  const [status, setStatus] = React.useState<StatusItem | 'todas'>(value.status)
  const [tags, setTags] = React.useState<string[]>(value.tags)
  const [textoTag, setTextoTag] = React.useState('')

  // Ao abrir, sincroniza o rascunho com o filtro aplicado.
  React.useEffect(() => {
    if (aberto) {
      setAtribuicao(value.atribuicao)
      setSelPessoas(value.pessoas)
      setEquipes(value.equipes)
      setStatus(value.status)
      setTags(value.tags)
      setTextoTag('')
    }
  }, [aberto, value.atribuicao, value.pessoas, value.equipes, value.status, value.tags])

  React.useEffect(() => {
    if (!aberto) return
    function onEsc(e: KeyboardEvent) {
      if (e.key === 'Escape') onFechar()
    }
    document.addEventListener('keydown', onEsc)
    return () => document.removeEventListener('keydown', onEsc)
  }, [aberto, onFechar])

  if (!aberto) return null

  function toggle<T>(lista: T[], set: (v: T[]) => void, item: T) {
    set(lista.includes(item) ? lista.filter(x => x !== item) : [...lista, item])
  }

  const todasMarcadas = pessoas.length > 0 && selPessoas.length === pessoas.length

  function adicionarTag() {
    const t = textoTag.trim()
    if (t && !tags.includes(t)) setTags(prev => [...prev, t])
    setTextoTag('')
  }

  function aplicar() {
    onAplicar({ atribuicao, pessoas: selPessoas, equipes, status, tags })
    onFechar()
  }

  return (
    <>
      {/* Backdrop transparente: captura o clique fora (inclusive no gatilho). */}
      <div className="fixed inset-0 z-40" onMouseDown={onFechar} aria-hidden />

      <div
        role="dialog"
        aria-label="Filtros da agenda"
        className="z-50 rounded-2xl border border-border bg-card p-4 shadow-xl max-sm:fixed max-sm:inset-x-4 max-sm:top-20 sm:absolute sm:right-0 sm:top-full sm:mt-2 sm:w-[min(20rem,calc(100vw-2rem))]"
      >
        <div className="mb-3 flex items-center justify-between px-2">
          <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
            <SlidersHorizontal className="h-3.5 w-3.5" aria-hidden />
            Filtros
          </p>
          <button
            type="button"
            onClick={onFechar}
            aria-label="Fechar filtros"
            className="rounded-full p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="max-h-[min(60vh,30rem)] space-y-5 overflow-y-auto pr-1">
          <section>
            <Eyebrow>Minhas atribuições</Eyebrow>
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
            <div className="mb-1.5 flex items-center justify-between px-2">
              <p className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
                Pessoas
              </p>
              {pessoas.length > 0 && (
                <button
                  type="button"
                  onClick={() => setSelPessoas(todasMarcadas ? [] : pessoas.map(p => p.id))}
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
            <Eyebrow>Equipes</Eyebrow>
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

          <section role="radiogroup" aria-label="Status">
            <Eyebrow>Status</Eyebrow>
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

          <section>
            <Eyebrow>Tags</Eyebrow>
            <div className="flex gap-2 px-2">
              <input
                value={textoTag}
                onChange={e => setTextoTag(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    adicionarTag()
                  }
                }}
                placeholder="Adicionar tag…"
                aria-label="Adicionar tag"
                className="h-9 w-full rounded-full border border-input bg-background px-3.5 text-sm placeholder:text-muted-foreground transition-colors hover:border-ring focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={adicionarTag}
                disabled={!textoTag.trim()}
                className="rounded-full"
              >
                Adicionar
              </Button>
            </div>
            {tags.length > 0 ? (
              <div className="mt-2.5 flex flex-wrap gap-1.5 px-2">
                {tags.map(t => (
                  <span
                    key={t}
                    className="inline-flex items-center gap-1 rounded-full bg-muted px-2.5 py-1 text-xs text-foreground"
                  >
                    {t}
                    <button
                      type="button"
                      onClick={() => setTags(prev => prev.filter(x => x !== t))}
                      className="text-muted-foreground transition-colors hover:text-foreground"
                      aria-label={`Remover ${t}`}
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </span>
                ))}
              </div>
            ) : (
              <p className="mt-2.5 px-2 text-sm text-muted-foreground">Nenhuma tag selecionada</p>
            )}
          </section>
        </div>

        <div className="mt-4 flex justify-end gap-2 border-t border-border pt-3">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onFechar}
            className="rounded-full"
          >
            Cancelar
          </Button>
          <Button
            type="button"
            size="sm"
            onClick={aplicar}
            className="rounded-full bg-foreground text-background hover:bg-foreground/90"
          >
            Aplicar
          </Button>
        </div>
      </div>
    </>
  )
}
