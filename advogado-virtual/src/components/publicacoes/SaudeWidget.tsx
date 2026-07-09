'use client'

import { useEffect, useState } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Spinner } from '@/components/ui/spinner'
import { cn, formatarDataHora, formatarDataRelativa } from '@/lib/utils'
import { Activity, AlertTriangle, CheckCircle2, RefreshCw } from 'lucide-react'

interface UltimaCaptura {
  oab: string
  uf: string
  status: 'sucesso' | 'falha' | 'parcial'
  qtd_encontradas: number
  qtd_novas: number
  finalizada_em: string | null
}

interface Saude {
  novas: number
  ultimas: UltimaCaptura[]
  ultimaSucessoEm: string | null
}

const LIMITE_HORAS = 26

/** Widget de saúde da captura DJEN. Fica VERMELHO quando não houve captura
 * bem-sucedida nas últimas 26h (ou nunca houve). */
export function SaudeWidget({ onNovas }: { onNovas?: (n: number) => void }) {
  const [dados, setDados] = useState<Saude | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let vivo = true
    ;(async () => {
      setLoading(true)
      try {
        const r = await fetch('/api/publicacoes/saude')
        if (!vivo) return
        if (r.ok) {
          const d: Saude = await r.json()
          setDados(d)
          onNovas?.(d.novas ?? 0)
        }
      } finally {
        if (vivo) setLoading(false)
      }
    })()
    return () => { vivo = false }
    // onNovas é estável (useCallback no pai); rodar 1x no mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  if (loading) {
    return (
      <Card>
        <CardContent className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
          <Spinner className="h-4 w-4" /> Verificando a última captura…
        </CardContent>
      </Card>
    )
  }

  if (!dados) return null

  const alerta =
    !dados.ultimaSucessoEm ||
    Date.now() - new Date(dados.ultimaSucessoEm).getTime() > LIMITE_HORAS * 3600_000

  return (
    <Card
      className={cn(
        'border-l-4',
        alerta ? 'border-l-destructive' : 'border-l-success'
      )}
    >
      <CardContent className="py-4">
        <div className="flex flex-wrap items-center gap-3">
          <div
            className={cn(
              'flex h-9 w-9 shrink-0 items-center justify-center rounded-full',
              alerta ? 'bg-destructive/10 text-destructive' : 'bg-success/10 text-success'
            )}
          >
            {alerta ? <AlertTriangle className="h-5 w-5" /> : <CheckCircle2 className="h-5 w-5" />}
          </div>

          <div className="min-w-0">
            <p className="flex items-center gap-2 text-sm font-semibold text-foreground">
              <Activity className="h-4 w-4 text-muted-foreground" aria-hidden />
              {alerta ? 'Captura de publicações com atraso' : 'Captura de publicações em dia'}
            </p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {dados.ultimaSucessoEm
                ? <>Última captura com sucesso {formatarDataRelativa(dados.ultimaSucessoEm)} · {formatarDataHora(dados.ultimaSucessoEm)}</>
                : 'Nenhuma captura bem-sucedida registrada ainda.'}
            </p>
          </div>

          <div className="ml-auto flex items-center gap-2">
            {dados.novas > 0 && (
              <Badge variant="warning">{dados.novas} nova{dados.novas > 1 ? 's' : ''}</Badge>
            )}
          </div>
        </div>

        {dados.ultimas.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-2 border-t border-border pt-3">
            {dados.ultimas.map((u, i) => (
              <span
                key={`${u.oab}-${u.uf}-${i}`}
                className="inline-flex items-center gap-1.5 rounded-md bg-muted/40 px-2.5 py-1 text-xs text-muted-foreground"
                title={u.finalizada_em ? formatarDataHora(u.finalizada_em) : 'Sem data de término'}
              >
                <RefreshCw className="h-3 w-3" aria-hidden />
                <span className="font-medium text-foreground">{u.oab}/{u.uf}</span>
                <StatusPonto status={u.status} />
                <span>{u.qtd_novas} nova{u.qtd_novas === 1 ? '' : 's'} de {u.qtd_encontradas}</span>
              </span>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function StatusPonto({ status }: { status: UltimaCaptura['status'] }) {
  const cor =
    status === 'sucesso' ? 'bg-success'
    : status === 'parcial' ? 'bg-warning'
    : 'bg-destructive'
  const rotulo =
    status === 'sucesso' ? 'Sucesso'
    : status === 'parcial' ? 'Parcial'
    : 'Falha'
  return (
    <span className="inline-flex items-center gap-1" title={rotulo}>
      <span className={cn('h-2 w-2 rounded-full', cor)} aria-hidden />
    </span>
  )
}
