'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Bell, MessageSquare } from 'lucide-react'
import { formatarDataHora, cn } from '@/lib/utils'

/**
 * Sino de comentários novos (canal de coordenação da equipe). Ícone com badge de
 * contagem + popover com a lista; clicar num item abre a tarefa (deep-link
 * /tarefas?task=<id>). Refaz a busca a cada 60s e ao focar a janela.
 *
 * Componente PRONTO e AUTOSSUFICIENTE: NÃO é montado aqui — a frente W2 o monta
 * no Header. Exporta-se de src/components/tarefas/SinoComentarios.tsx.
 */

interface ComentarioNovo {
  id:         string
  taskId:     string
  taskTitulo: string
  autorNome:  string
  trecho:     string
  criadoEm:   string
}

function iniciais(nome: string): string {
  return nome.split(' ').map(n => n[0]).filter(Boolean).slice(0, 2).join('').toUpperCase() || '?'
}

export function SinoComentarios({ className }: { className?: string }) {
  const router = useRouter()
  const [itens,  setItens]  = useState<ComentarioNovo[]>([])
  const [total,  setTotal]  = useState(0)
  const [aberto, setAberto] = useState(false)
  const parado = useRef(false) // 401/403 → para de checar nesta sessão
  const boxRef = useRef<HTMLDivElement | null>(null)

  const carregar = useCallback(async () => {
    if (parado.current) return
    try {
      const r = await fetch('/api/tasks/comentarios-novos')
      if (r.status === 401 || r.status === 403) { parado.current = true; return }
      if (!r.ok) return
      const d = await r.json().catch(() => ({}))
      const lista = (d.comentarios ?? []) as ComentarioNovo[]
      setItens(lista)
      setTotal(typeof d.total === 'number' ? d.total : lista.length)
    } catch { /* rede: tenta no próximo ciclo */ }
  }, [])

  // Refetch: agora, a cada 60s e ao focar a janela.
  useEffect(() => {
    void carregar()
    const id = setInterval(() => void carregar(), 60_000)
    const onFocus = () => void carregar()
    window.addEventListener('focus', onFocus)
    return () => {
      clearInterval(id)
      window.removeEventListener('focus', onFocus)
    }
  }, [carregar])

  // Fecha o popover ao clicar fora.
  useEffect(() => {
    if (!aberto) return
    const onDoc = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setAberto(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [aberto])

  function abrirTarefa(taskId: string) {
    setAberto(false)
    router.push(`/tarefas?task=${taskId}`)
    // O modal marca "visto" ao abrir → recarrega logo depois p/ o item sumir do sino.
    setTimeout(() => void carregar(), 1_500)
  }

  return (
    <div ref={boxRef} className={cn('relative', className)}>
      <button
        type="button"
        onClick={() => setAberto(a => !a)}
        aria-label={total > 0 ? `${total} comentário(s) novo(s)` : 'Comentários'}
        aria-expanded={aberto}
        className="relative flex h-9 w-9 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
      >
        <Bell className="h-5 w-5" />
        {total > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-[1rem] items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-bold leading-none text-white">
            {total > 9 ? '9+' : total}
          </span>
        )}
      </button>

      {aberto && (
        <div className="absolute right-0 z-50 mt-2 w-80 max-w-[90vw] overflow-hidden rounded-xl border border-border bg-card shadow-2xl">
          <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
            <span className="text-sm font-semibold text-foreground">Comentários novos</span>
            {total > 0 && (
              <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-semibold text-primary">
                {total}
              </span>
            )}
          </div>

          {itens.length === 0 ? (
            <div className="flex flex-col items-center gap-1.5 px-4 py-8 text-center text-sm text-muted-foreground">
              <MessageSquare className="h-5 w-5 opacity-60" />
              Nenhum comentário novo.
            </div>
          ) : (
            <ul className="max-h-96 divide-y divide-border overflow-y-auto">
              {itens.map(c => (
                <li key={c.id}>
                  <button
                    type="button"
                    onClick={() => abrirTarefa(c.taskId)}
                    className="flex w-full items-start gap-2.5 px-4 py-3 text-left hover:bg-muted/60 transition-colors"
                  >
                    <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/80 text-[10px] font-bold text-white">
                      {iniciais(c.autorNome)}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm text-foreground">
                        <span className="font-semibold">{c.autorNome}</span>
                        {' comentou em '}
                        <span className="font-medium">{c.taskTitulo}</span>
                      </p>
                      <p className="truncate text-xs text-muted-foreground">{c.trecho}</p>
                      <p className="mt-0.5 text-[11px] text-muted-foreground">{formatarDataHora(c.criadoEm)}</p>
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}
