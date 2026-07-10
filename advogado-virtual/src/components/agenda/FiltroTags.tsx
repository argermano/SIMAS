'use client'

import * as React from 'react'
import { ChevronDown, Tag, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'

interface FiltroTagsProps {
  value: string[]
  onAplicar: (tags: string[]) => void
}

export function FiltroTags({ value, onAplicar }: FiltroTagsProps) {
  const [aberto, setAberto] = React.useState(false)
  const [tags, setTags] = React.useState<string[]>(value)
  const [texto, setTexto] = React.useState('')
  const ref = React.useRef<HTMLDivElement>(null)

  React.useEffect(() => {
    if (aberto) {
      setTags(value)
      setTexto('')
    }
  }, [aberto, value])

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

  function adicionar() {
    const t = texto.trim()
    if (t && !tags.includes(t)) setTags(prev => [...prev, t])
    setTexto('')
  }

  function remover(t: string) {
    setTags(prev => prev.filter(x => x !== t))
  }

  function aplicar() {
    onAplicar(tags)
    setAberto(false)
  }

  const ativo = value.length > 0

  return (
    <div className="relative" ref={ref}>
      <Button
        type="button"
        variant="secondary"
        size="sm"
        onClick={() => setAberto(a => !a)}
        className={cn(ativo && 'border-primary text-primary')}
      >
        <Tag className="h-4 w-4" />
        {ativo ? `Tags (${value.length})` : 'Tags'}
        <ChevronDown className="h-4 w-4" />
      </Button>

      {aberto && (
        <div className="absolute left-0 z-40 mt-2 w-72 rounded-lg border border-border bg-card p-4 shadow-lg">
          <div className="flex gap-2">
            <input
              value={texto}
              onChange={e => setTexto(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  adicionar()
                }
              }}
              placeholder="Adicionar tag…"
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
            <Button type="button" variant="secondary" size="sm" onClick={adicionar} disabled={!texto.trim()}>
              Adicionar
            </Button>
          </div>

          {tags.length > 0 ? (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {tags.map(t => (
                <span
                  key={t}
                  className="inline-flex items-center gap-1 rounded-full bg-muted px-2.5 py-1 text-xs text-foreground"
                >
                  {t}
                  <button
                    type="button"
                    onClick={() => remover(t)}
                    className="text-muted-foreground hover:text-foreground"
                    aria-label={`Remover ${t}`}
                  >
                    <X className="h-3 w-3" />
                  </button>
                </span>
              ))}
            </div>
          ) : (
            <p className="mt-3 text-sm text-muted-foreground">Nenhuma tag selecionada</p>
          )}

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
