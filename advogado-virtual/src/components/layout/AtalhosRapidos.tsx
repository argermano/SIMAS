'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Plus, ListChecks, CalendarPlus, UserPlus, Headset, type LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'

/**
 * Botão "+" de criação rápida na barra superior (ao lado do tema/sino).
 * Menu client-side: cada item navega com router.push. As páginas de destino
 * abrem o modal correspondente ao ler o parâmetro da URL:
 *   - /tarefas?nova=1  → TaskFormModal
 *   - /agenda?novo=1   → EventoModal (modo "novo")
 * Cliente/atendimento têm páginas próprias de criação.
 */

interface Atalho {
  rotulo: string
  destino: string
  Icone: LucideIcon
}

const ATALHOS: Atalho[] = [
  { rotulo: 'Nova tarefa',      destino: '/tarefas?nova=1', Icone: ListChecks },
  { rotulo: 'Novo evento',      destino: '/agenda?novo=1',  Icone: CalendarPlus },
  { rotulo: 'Novo cliente',     destino: '/clientes/novo',  Icone: UserPlus },
  { rotulo: 'Novo atendimento', destino: '/atendimentos/novo', Icone: Headset },
]

export function AtalhosRapidos({ className }: { className?: string }) {
  const router = useRouter()
  const [aberto, setAberto] = useState(false)
  const boxRef = useRef<HTMLDivElement | null>(null)

  // Fecha ao clicar fora ou apertar Esc.
  useEffect(() => {
    if (!aberto) return
    const onDoc = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setAberto(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setAberto(false)
    }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
    }
  }, [aberto])

  function ir(destino: string) {
    setAberto(false)
    router.push(destino)
  }

  return (
    <div ref={boxRef} className={cn('relative', className)}>
      <button
        type="button"
        onClick={() => setAberto(a => !a)}
        aria-label="Criar (tarefa, evento, cliente, atendimento)"
        aria-haspopup="menu"
        aria-expanded={aberto}
        title="Criar"
        className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      >
        <Plus className="h-[18px] w-[18px]" />
      </button>

      {aberto && (
        <div
          role="menu"
          aria-label="Criação rápida"
          className="absolute right-0 z-50 mt-2 w-52 max-w-[90vw] overflow-hidden rounded-xl border border-border bg-card py-1 shadow-2xl"
        >
          {ATALHOS.map(({ rotulo, destino, Icone }) => (
            <button
              key={destino}
              type="button"
              role="menuitem"
              onClick={() => ir(destino)}
              className="flex w-full items-center gap-3 px-3 py-2 text-left text-sm text-foreground transition-colors hover:bg-muted/60"
            >
              <Icone className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
              {rotulo}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
