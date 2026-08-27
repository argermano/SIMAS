'use client'

// Uma linha, sempre visível, com o que a sessão já custou e o que a próxima
// rodada deve custar — em REAIS (§10 do plano: o advogado nunca vê token).
//
// A estimativa é um AVISO, não uma cobrança: antes da primeira rodada ela nem
// mediu o dossiê (o GET diz `parcial`), por isso o "a partir de".

import { formatarUsdEmReais } from '@/lib/ia/sessao/custo-brl'
import type { EstimativaSessao } from './useSessaoPeca'

export function BarraCusto({
  custoSessaoUsd,
  custoRodadaUsd,
  estimativa,
  emRodada,
}: {
  custoSessaoUsd: number
  /** Custo da rodada em curso, quando a API já o informou. */
  custoRodadaUsd: number
  estimativa: EstimativaSessao | null
  emRodada: boolean
}) {
  const total = custoSessaoUsd + (emRodada ? custoRodadaUsd : 0)
  const proxima = estimativa?.custoUsd ?? 0

  return (
    <p
      className="truncate px-3 py-1 text-[11px] text-muted-foreground"
      title="Custo de lista da API convertido em reais. A cobrança por créditos entra na Fase 3."
    >
      Sessão: <span className="font-medium text-foreground">{formatarUsdEmReais(total)}</span>
      {proxima > 0 && (
        <>
          {' · '}
          {emRodada ? 'rodada em curso' : 'próxima rodada'} {estimativa?.parcial ? 'a partir de' : '≈'}{' '}
          {formatarUsdEmReais(proxima)}
        </>
      )}
    </p>
  )
}
