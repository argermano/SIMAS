'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Sun, ChevronDown, AlertTriangle, Clock, ArrowRight } from 'lucide-react'
import { cn } from '@/lib/utils'

// Painel "Meu dia" — fica no TOPO de /tarefas, acima do Kanban. Lista as tarefas
// NÃO concluídas do usuário (responsável ou envolvido) que estão ATRASADAS ou
// VENCEM HOJE e aponta por onde começar. Só LÊ e navega — nunca conclui nem gera
// peça (isso é do motor, conduzido por humano). Dados vêm de /api/tasks/meu-dia.

type Prioridade = 'baixa' | 'media' | 'alta' | 'urgente'

interface Item {
  id: string
  titulo: string
  prioridade: Prioridade
  vinculoRotulo: string | null
}

interface MeuDiaData {
  atrasadas: Item[]
  hoje: Item[]
  atrasadasTotal: number
  hojeTotal: number
  comecePorAqui: { id: string; criterio: string } | null
}

// Mesma paleta de prioridade dos cards do Kanban (TaskCard).
const COR_PRIORIDADE: Record<Prioridade, string> = {
  baixa: '#10b981',
  media: '#3b82f6',
  alta: '#f59e0b',
  urgente: '#ef4444',
}
const ROTULO_PRIORIDADE: Record<Prioridade, string> = {
  baixa: 'Baixa',
  media: 'Média',
  alta: 'Alta',
  urgente: 'Urgente',
}

// Estado do colapso é lembrado entre sessões (pedido: "lembrando o estado").
const LS_KEY = 'meu-dia:aberto'

export function MeuDia() {
  const router = useRouter()
  const [aberto, setAberto] = useState(true)
  const [dados, setDados] = useState<MeuDiaData | null>(null)
  const [carregando, setCarregando] = useState(true)
  const [falhou, setFalhou] = useState(false)

  // Lê o colapso salvo só no cliente (evita divergência de hidratação).
  useEffect(() => {
    if (typeof window === 'undefined') return
    const salvo = window.localStorage.getItem(LS_KEY)
    if (salvo === '0') setAberto(false)
  }, [])

  useEffect(() => {
    let vivo = true
    fetch('/api/tasks/meu-dia')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error('meu-dia'))))
      .then((d: MeuDiaData) => {
        if (vivo) setDados(d)
      })
      .catch(() => {
        if (vivo) setFalhou(true)
      })
      .finally(() => {
        if (vivo) setCarregando(false)
      })
    return () => {
      vivo = false
    }
  }, [])

  const alternar = useCallback(() => {
    setAberto((v) => {
      const proximo = !v
      try {
        window.localStorage.setItem(LS_KEY, proximo ? '1' : '0')
      } catch {
        /* localStorage indisponível: apenas não persiste */
      }
      return proximo
    })
  }, [])

  // Deep-link do padrão da casa: ?task=<id> abre o detalhe no KanbanBoard.
  const abrirTarefa = useCallback(
    (id: string) => router.push(`/tarefas?task=${id}`),
    [router],
  )

  // Enquanto carrega ou se a chamada falhou, o painel some (não atrapalha o board).
  if (carregando || falhou || !dados) return null

  const total = dados.atrasadasTotal + dados.hojeTotal
  const vazio = total === 0
  const destaqueId = dados.comecePorAqui?.id ?? null

  return (
    <section className="rounded-xl border border-border bg-card">
      {/* Cabeçalho colapsável */}
      <button
        type="button"
        onClick={alternar}
        aria-expanded={aberto}
        className="flex w-full items-center gap-2 px-4 py-2.5 text-left"
      >
        <Sun className="h-4 w-4 shrink-0 text-amber-500" />
        <span className="text-sm font-semibold text-foreground font-heading">Meu dia</span>

        {!vazio && (
          <span
            className={cn(
              'rounded-full px-2 py-0.5 text-xs font-semibold',
              dados.atrasadasTotal > 0
                ? 'bg-destructive/10 text-destructive'
                : 'bg-amber-500/10 text-amber-600 dark:text-amber-400',
            )}
          >
            {total}
          </span>
        )}

        <ChevronDown
          className={cn(
            'ml-auto h-4 w-4 shrink-0 text-muted-foreground transition-transform',
            aberto ? '' : '-rotate-90',
          )}
        />
      </button>

      {aberto && (
        <div className="border-t border-border px-4 py-3">
          {vazio ? (
            <p className="text-sm text-muted-foreground">Nada vencendo hoje 🎉</p>
          ) : (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <Coluna
                icone={<AlertTriangle className="h-3.5 w-3.5" />}
                titulo="Atrasadas"
                tom="atrasada"
                itens={dados.atrasadas}
                total={dados.atrasadasTotal}
                destaqueId={destaqueId}
                criterio={dados.comecePorAqui?.criterio}
                onAbrir={abrirTarefa}
              />
              <Coluna
                icone={<Clock className="h-3.5 w-3.5" />}
                titulo="Vencem hoje"
                tom="hoje"
                itens={dados.hoje}
                total={dados.hojeTotal}
                destaqueId={destaqueId}
                criterio={dados.comecePorAqui?.criterio}
                onAbrir={abrirTarefa}
              />
            </div>
          )}
        </div>
      )}
    </section>
  )
}

interface ColunaProps {
  icone: React.ReactNode
  titulo: string
  tom: 'atrasada' | 'hoje'
  itens: Item[]
  total: number
  destaqueId: string | null
  criterio?: string
  onAbrir: (id: string) => void
}

function Coluna({ icone, titulo, tom, itens, total, destaqueId, criterio, onAbrir }: ColunaProps) {
  const corTom =
    tom === 'atrasada'
      ? 'text-destructive'
      : 'text-amber-600 dark:text-amber-400'
  const restante = total - itens.length

  return (
    <div>
      <p className={cn('mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide', corTom)}>
        {icone}
        {titulo}
        <span className="text-muted-foreground">({total})</span>
      </p>

      {itens.length === 0 ? (
        <p className="text-sm text-muted-foreground">—</p>
      ) : (
        <ul className="space-y-1.5">
          {itens.map((item) => {
            const destaque = item.id === destaqueId
            return (
              <li key={item.id}>
                {destaque && (
                  <p className="mb-1 flex items-center gap-1 text-[11px] font-semibold text-primary">
                    <ArrowRight className="h-3 w-3 shrink-0" />
                    Comece por aqui
                    {criterio && <span className="font-normal text-muted-foreground">· {criterio}</span>}
                  </p>
                )}
                <button
                  type="button"
                  onClick={() => onAbrir(item.id)}
                  className={cn(
                    'flex w-full items-start gap-2 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-muted',
                    destaque && 'bg-primary/5 ring-1 ring-primary/40 hover:bg-primary/10',
                  )}
                >
                  <span
                    title={`Prioridade: ${ROTULO_PRIORIDADE[item.prioridade]}`}
                    className="mt-1.5 h-2 w-2 shrink-0 rounded-full"
                    style={{ backgroundColor: COR_PRIORIDADE[item.prioridade] }}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="line-clamp-2 text-sm text-foreground">{item.titulo}</span>
                    {item.vinculoRotulo && (
                      <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                        {item.vinculoRotulo}
                      </span>
                    )}
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
      )}

      {restante > 0 && (
        <p className="mt-1.5 px-2 text-xs text-muted-foreground">+{restante} mais</p>
      )}
    </div>
  )
}
