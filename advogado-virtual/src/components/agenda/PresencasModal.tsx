'use client'

// Modal "Presenças" (Peça 3 — Agenda Conectada, admin/advogado): gestão da
// presença por unidade nos próximos 30 dias. Cada linha (dia) tem um select da
// unidade (— / Brasília / Florianópolis / Blumenau) e observação; salva por dia
// via PUT /api/agenda/presencas (upsert) ou DELETE (unidade "—").

import { useCallback, useEffect, useRef, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Dialog } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Select } from '@/components/ui/select'
import { useToast } from '@/components/ui/toast'
import type { Pessoa } from '@/lib/agenda/tipos'
import { chaveDia } from '@/lib/agenda/grade'
import { ROTULO_UNIDADE, UNIDADES, type UnidadePresenca } from '@/lib/agenda/presenca'

/** Presença de um dia (linha de `presencas` normalizada para a UI). */
export interface PresencaDia {
  userId: string
  /** Dia civil YYYY-MM-DD. */
  data: string
  unidade: UnidadePresenca
  observacao: string | null
}

interface LinhaDia {
  unidade: UnidadePresenca | ''
  observacao: string
}

const DIA_MS = 86_400_000
const DIAS_JANELA = 30

const OPCOES_UNIDADE = [
  { value: '', label: '—' },
  ...UNIDADES.map(u => ({ value: u, label: ROTULO_UNIDADE[u] })),
]

const _fmtDia = new Intl.DateTimeFormat('pt-BR', {
  timeZone: 'UTC',
  weekday: 'short',
  day: '2-digit',
  month: '2-digit',
})

/** Próximos `n` dias civis (YYYY-MM-DD), a partir de hoje (SP). */
function proximosDias(n: number): string[] {
  const hoje = chaveDia(new Date().toISOString())
  const base = new Date(`${hoje}T12:00:00Z`).getTime()
  return Array.from({ length: n }, (_, i) =>
    new Date(base + i * DIA_MS).toISOString().slice(0, 10),
  )
}

/** "sex., 10/07" -> "Sex 10/07". */
function rotuloDia(dataISO: string): string {
  const s = _fmtDia.format(new Date(`${dataISO}T12:00:00Z`))
  const limpo = s.replace('.', '').replace(',', '')
  return limpo.charAt(0).toUpperCase() + limpo.slice(1)
}

function ehFimDeSemana(dataISO: string): boolean {
  const dow = new Date(`${dataISO}T12:00:00Z`).getUTCDay()
  return dow === 0 || dow === 6
}

interface PresencasModalProps {
  aberto: boolean
  onFechar: () => void
  /** Usuários ativos do tenant (seletor de pessoa). */
  pessoas: Pessoa[]
  /** Pessoa pré-selecionada (advogada principal, se houver). */
  defaultUserId: string
  /** Notifica o pai após salvar/remover (para recarregar a grade). */
  onAlterado?: () => void
}

export function PresencasModal({
  aberto, onFechar, pessoas, defaultUserId, onAlterado,
}: PresencasModalProps) {
  const { error: toastErro } = useToast()

  const [userId, setUserId] = useState(defaultUserId)
  const [linhas, setLinhas] = useState<Record<string, LinhaDia>>({})
  const [carregando, setCarregando] = useState(false)
  const [salvandoDia, setSalvandoDia] = useState<string | null>(null)
  // Snapshot do que está persistido ("unidade|observacao"), para evitar PUTs redundantes no blur.
  const salvoRef = useRef<Record<string, string>>({})

  const dias = proximosDias(DIAS_JANELA)

  const carregar = useCallback(async (uid: string) => {
    setCarregando(true)
    try {
      const janela = proximosDias(DIAS_JANELA)
      const params = new URLSearchParams({
        de: janela[0],
        ate: janela[janela.length - 1],
        userId: uid,
      })
      const res = await fetch(`/api/agenda/presencas?${params.toString()}`)
      if (!res.ok) throw new Error('Falha ao carregar presenças')
      const dados = (await res.json()) as { presencas?: Array<Record<string, unknown>> }
      const mapa: Record<string, LinhaDia> = {}
      const salvo: Record<string, string> = {}
      for (const p of dados.presencas ?? []) {
        const data = String(p.data ?? '').slice(0, 10)
        const unidade = p.unidade as UnidadePresenca
        if (!data || !UNIDADES.includes(unidade)) continue
        const observacao = typeof p.observacao === 'string' ? p.observacao : ''
        mapa[data] = { unidade, observacao }
        salvo[data] = `${unidade}|${observacao}`
      }
      setLinhas(mapa)
      salvoRef.current = salvo
    } catch {
      toastErro('Não foi possível carregar as presenças')
    } finally {
      setCarregando(false)
    }
  }, [toastErro])

  // Ao abrir, volta para a pessoa padrão e carrega.
  useEffect(() => {
    if (aberto) setUserId(defaultUserId)
  }, [aberto, defaultUserId])

  useEffect(() => {
    if (aberto && userId) void carregar(userId)
  }, [aberto, userId, carregar])

  /** Persiste a linha do dia: unidade vazia => DELETE; senão PUT (upsert). */
  async function aplicar(data: string, unidade: UnidadePresenca | '', observacao: string) {
    const anterior = linhas[data]
    const haviaSalvo = salvoRef.current[data] !== undefined
    if (!unidade && !haviaSalvo) return // nada a remover

    setSalvandoDia(data)
    try {
      let res: Response
      if (!unidade) {
        const params = new URLSearchParams({ userId, data })
        res = await fetch(`/api/agenda/presencas?${params.toString()}`, { method: 'DELETE' })
      } else {
        res = await fetch('/api/agenda/presencas', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            userId,
            data,
            unidade,
            ...(observacao.trim() ? { observacao: observacao.trim() } : {}),
          }),
        })
      }
      if (!res.ok) throw new Error('Falha ao salvar presença')
      if (unidade) salvoRef.current[data] = `${unidade}|${observacao}`
      else delete salvoRef.current[data]
      onAlterado?.()
    } catch {
      toastErro('Não foi possível salvar a presença')
      // Restaura o estado anterior da linha.
      setLinhas(prev => {
        const prox = { ...prev }
        if (anterior) prox[data] = anterior
        else delete prox[data]
        return prox
      })
    } finally {
      setSalvandoDia(null)
    }
  }

  function mudarUnidade(data: string, unidade: UnidadePresenca | '') {
    const observacao = linhas[data]?.observacao ?? ''
    setLinhas(prev => {
      const prox = { ...prev }
      if (unidade) prox[data] = { unidade, observacao }
      else delete prox[data]
      return prox
    })
    void aplicar(data, unidade, observacao)
  }

  function mudarObservacao(data: string, observacao: string) {
    setLinhas(prev => {
      const atual = prev[data]
      if (!atual) return prev
      return { ...prev, [data]: { ...atual, observacao } }
    })
  }

  function salvarObservacao(data: string) {
    const linha = linhas[data]
    if (!linha || !linha.unidade) return
    if (salvoRef.current[data] === `${linha.unidade}|${linha.observacao}`) return
    void aplicar(data, linha.unidade, linha.observacao)
  }

  return (
    <Dialog
      open={aberto}
      onClose={onFechar}
      title="Presenças"
      description="Em qual unidade a pessoa estará em cada dia (próximos 30 dias). As alterações são salvas na hora."
      size="lg"
      footer={
        <Button variant="secondary" size="sm" onClick={onFechar}>
          Fechar
        </Button>
      }
    >
      <div className="space-y-4">
        <div className="max-w-xs">
          <Select
            label="Pessoa"
            value={userId}
            onChange={e => setUserId(e.target.value)}
            options={pessoas.map(p => ({ value: p.id, label: p.nome }))}
            className="h-9 text-sm"
          />
        </div>

        {carregando ? (
          <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            Carregando presenças...
          </div>
        ) : (
          <ul className="max-h-[50vh] divide-y divide-border overflow-y-auto rounded-lg border border-border">
            {dias.map(data => {
              const linha = linhas[data]
              const salvando = salvandoDia === data
              return (
                <li
                  key={data}
                  className={cn(
                    'grid grid-cols-[6.5rem_1fr] items-center gap-2 px-3 py-2 sm:grid-cols-[6.5rem_11rem_1fr_1.25rem]',
                    ehFimDeSemana(data) && 'bg-muted/30',
                  )}
                >
                  <span
                    className={cn(
                      'text-sm tabular-nums',
                      linha ? 'font-semibold text-foreground' : 'text-muted-foreground',
                    )}
                  >
                    {rotuloDia(data)}
                  </span>
                  <Select
                    aria-label={`Unidade em ${rotuloDia(data)}`}
                    value={linha?.unidade ?? ''}
                    onChange={e => mudarUnidade(data, e.target.value as UnidadePresenca | '')}
                    options={OPCOES_UNIDADE}
                    disabled={salvando}
                    className="h-9 text-sm"
                  />
                  <input
                    type="text"
                    value={linha?.observacao ?? ''}
                    onChange={e => mudarObservacao(data, e.target.value)}
                    onBlur={() => salvarObservacao(data)}
                    placeholder={linha ? 'Observação (opcional)' : ''}
                    aria-label={`Observação em ${rotuloDia(data)}`}
                    disabled={!linha || salvando}
                    className="col-span-2 h-9 w-full rounded-md border border-input bg-background px-2.5 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:border-transparent disabled:bg-transparent sm:col-span-1"
                  />
                  <span className="hidden h-4 w-4 items-center justify-center sm:flex">
                    {salvando && (
                      <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" aria-hidden />
                    )}
                  </span>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </Dialog>
  )
}
