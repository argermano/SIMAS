'use client'

import { useState } from 'react'
import Link from 'next/link'
import { AlertTriangle, User } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/ui/dialog'
import { useToast } from '@/components/ui/toast'
import { formatarData } from '@/lib/utils'
import type { SentinelaAlerta } from './tipos'

/** "há X dias" a partir da data do movimento (piso em 0 = "hoje"). */
function haQuantosDias(iso: string): string {
  const dias = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000))
  if (dias === 0) return 'hoje'
  return dias === 1 ? 'há 1 dia' : `há ${dias} dias`
}

/**
 * Painel âmbar da sentinela DataJud × DJEN: movimentos que implicam publicação
 * no diário mas SEM comunicação correspondente no DJEN (possível falha de envio
 * pelo tribunal). Só renderiza quando há alertas ABERTOS. É triagem interna:
 * nunca calcula prazo e nunca notifica cliente.
 */
export function SentinelaPanel({
  alertas,
  onRecarregar,
}: {
  alertas: SentinelaAlerta[]
  onRecarregar: () => void
}) {
  const { success, error: toastError } = useToast()
  const [ocupado, setOcupado] = useState<string | null>(null)
  const [ignorando, setIgnorando] = useState<SentinelaAlerta | null>(null)

  const abertos = alertas.filter((a) => a.status === 'aberta')
  if (abertos.length === 0) return null

  /** POST da ação humana (claim atômico no servidor). Recarrega SEMPRE ao final:
   * em conflito (outro usuário resolveu antes) a lista se ressincroniza. */
  async function resolver(alerta: SentinelaAlerta, acao: 'verificada' | 'ignorada') {
    setOcupado(alerta.id)
    try {
      const r = await fetch(`/api/publicacoes/sentinela/${alerta.id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ acao }),
      })
      const d = await r.json().catch(() => ({}))
      if (!r.ok) {
        toastError('Não foi possível atualizar o alerta', d.error ?? 'Tente novamente.')
        return
      }
      if (acao === 'verificada') {
        success('Alerta resolvido', 'Marcado como verificado no PJe.')
      } else {
        success('Alerta ignorado', 'Ele sai da lista de pendências.')
      }
    } finally {
      setOcupado(null)
      setIgnorando(null)
      onRecarregar()
    }
  }

  return (
    <div role="alert" className="rounded-xl border border-warning/50 bg-warning/10 p-4">
      <p className="flex items-center gap-2 font-bold text-warning">
        <AlertTriangle className="h-5 w-5 shrink-0" aria-hidden />
        Possíveis publicações não encontradas no DJEN ({abertos.length})
      </p>

      <ul className="mt-3 space-y-2">
        {abertos.map((a) => (
          <li
            key={a.id}
            className="flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-lg border border-warning/30 bg-card/60 px-3 py-2"
          >
            <div className="min-w-0 flex-1">
              <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                <span className="font-mono text-xs font-semibold text-foreground">
                  {a.numeroMascara || a.numeroProcesso}
                </span>
                {a.clienteId && a.clienteNome ? (
                  <Link
                    href={`/clientes/${a.clienteId}`}
                    className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
                  >
                    <User className="h-3.5 w-3.5" aria-hidden /> {a.clienteNome}
                  </Link>
                ) : a.clienteNome ? (
                  <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                    <User className="h-3.5 w-3.5" aria-hidden /> {a.clienteNome}
                  </span>
                ) : null}
              </p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {a.movimentoNome} · {formatarData(a.movimentoData)} ·{' '}
                <span className="font-medium text-foreground/80">{haQuantosDias(a.movimentoData)}</span>
              </p>
            </div>

            <div className="flex shrink-0 items-center gap-1.5">
              <Button
                variant="secondary"
                size="sm"
                disabled={ocupado !== null}
                loading={ocupado === a.id && !ignorando}
                onClick={() => void resolver(a, 'verificada')}
              >
                Verifiquei no PJe
              </Button>
              <Button
                variant="ghost"
                size="sm"
                disabled={ocupado !== null}
                onClick={() => setIgnorando(a)}
              >
                Ignorar
              </Button>
            </div>
          </li>
        ))}
      </ul>

      <p className="mt-3 text-xs text-warning/90">
        O DJEN é o canal oficial de publicação. Um movimento de publicação sem comunicação no
        DJEN pode indicar falha de envio pelo tribunal — confira o expediente no PJe. A
        comunicação também pode ter sido dirigida apenas a outra parte (a captura é pela OAB
        do escritório); nesse caso, use &quot;Ignorar&quot;. Nenhum prazo é calculado
        automaticamente.
      </p>

      <ConfirmDialog
        open={ignorando !== null}
        onClose={() => setIgnorando(null)}
        onConfirm={() => { if (ignorando) void resolver(ignorando, 'ignorada') }}
        title="Ignorar este alerta?"
        description={
          ignorando
            ? `O alerta do processo ${ignorando.numeroMascara || ignorando.numeroProcesso} (${ignorando.movimentoNome}) sairá da lista e não voltará a aparecer. Ignore apenas se tiver certeza de que não há expediente pendente no DJEN.`
            : ''
        }
        confirmLabel="Ignorar alerta"
        variant="danger"
        loading={ocupado !== null && ignorando !== null}
      />
    </div>
  )
}
