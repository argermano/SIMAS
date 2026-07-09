'use client'

import { Badge } from '@/components/ui/badge'
import { Spinner } from '@/components/ui/spinner'
import { cn, formatarDataHora, formatarDataRelativa } from '@/lib/utils'
import { AlertTriangle, CheckCircle2 } from 'lucide-react'
import type { SaudePublicacoes, UltimaCaptura } from './tipos'

const LIMITE_HORAS = 26

/** Uma OAB monitorada — contagem da caixa + status da última rodada (se houver). */
interface ChipOab {
  oab: string
  uf: string
  novas: number
  total: number
  status: UltimaCaptura['status'] | null
}

/** Índice OAB→status da rodada mais recente (para o pontinho verde/amarelo/vermelho).
 * `ultimas` vem ordenada do mais novo p/ o mais antigo → 1ª ocorrência vence. */
function statusPorOab(ultimas: UltimaCaptura[]): Map<string, UltimaCaptura['status']> {
  const m = new Map<string, UltimaCaptura['status']>()
  for (const u of ultimas) {
    const chave = `${u.oab}/${u.uf}`
    if (!m.has(chave)) m.set(chave, u.status)
  }
  return m
}

/** Chips por OAB. Fonte primária é `porOab` (autoritativo: só inscrições REAIS
 * com publicação na caixa, sem duplicar). Fallback ao colapso de `ultimas`
 * quando o payload ainda não trouxer `porOab`. O status vem sempre de `ultimas`. */
function chipsPorOab(dados: SaudePublicacoes): ChipOab[] {
  const status = statusPorOab(dados.ultimas)
  if (dados.porOab && dados.porOab.length > 0) {
    return dados.porOab.map((o) => ({
      oab: o.oab,
      uf: o.uf,
      novas: o.novas,
      total: o.total,
      status: status.get(`${o.oab}/${o.uf}`) ?? null,
    }))
  }
  // Fallback: colapsa `ultimas` (novas/total da última rodada por inscrição).
  const vistos = new Map<string, ChipOab>()
  for (const u of dados.ultimas) {
    const chave = `${u.oab}/${u.uf}`
    if (vistos.has(chave)) continue
    vistos.set(chave, { oab: u.oab, uf: u.uf, novas: u.qtd_novas, total: u.qtd_encontradas, status: u.status })
  }
  return Array.from(vistos.values())
}

/** Barra de SAÚDE da captura DJEN (topo da tela de Publicações). Não faz fetch
 * próprio: recebe o payload de /saude carregado pela CaixaPublicacoes (fonte
 * única), de modo que saúde e contadores recarreguem juntos após um tratamento.
 * Fica em ALERTA (vermelho) quando não houve captura bem-sucedida nas últimas 26h. */
export function SaudeWidget({ dados, loading }: { dados: SaudePublicacoes | null; loading: boolean }) {
  if (loading && !dados) {
    return (
      <div className="flex items-center gap-2 rounded-xl border border-border bg-card px-5 py-4 text-sm text-muted-foreground shadow-card">
        <Spinner className="h-4 w-4" /> Verificando a última captura…
      </div>
    )
  }

  if (!dados) return null

  const alerta =
    !dados.ultimaSucessoEm ||
    Date.now() - new Date(dados.ultimaSucessoEm).getTime() > LIMITE_HORAS * 3600_000

  const chips = chipsPorOab(dados)

  return (
    <div
      className={cn(
        'rounded-xl border border-l-4 border-border bg-card px-5 py-4 shadow-card',
        alerta ? 'border-l-destructive' : 'border-l-success',
      )}
    >
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <div
          className={cn(
            'flex h-9 w-9 shrink-0 items-center justify-center rounded-full',
            alerta ? 'bg-destructive/10 text-destructive' : 'bg-success/10 text-success',
          )}
        >
          {alerta ? <AlertTriangle className="h-5 w-5" /> : <CheckCircle2 className="h-5 w-5" />}
        </div>

        <div className="min-w-0">
          <p className="text-sm font-semibold text-foreground">
            {alerta ? 'Captura de publicações com atraso' : 'Captura de publicações em dia'}
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {dados.ultimaSucessoEm ? (
              <>
                Última captura {formatarDataRelativa(dados.ultimaSucessoEm)}
                {' · '}
                {formatarDataHora(dados.ultimaSucessoEm)}
              </>
            ) : (
              'Nenhuma captura bem-sucedida registrada ainda.'
            )}
          </p>
        </div>

        {dados.novas > 0 && (
          <Badge variant="warning" className="ml-auto shrink-0">
            {dados.novas} nova{dados.novas > 1 ? 's' : ''}
          </Badge>
        )}
      </div>

      {chips.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2 border-t border-border pt-3">
          {chips.map((c) => (
            <span
              key={`${c.oab}/${c.uf}`}
              className="inline-flex items-center gap-2 rounded-full border border-border bg-muted/40 px-3 py-1 text-xs text-muted-foreground"
              title={`OAB ${c.oab}/${c.uf}: ${c.novas} novas de ${c.total} na caixa`}
            >
              {c.status && <StatusPonto status={c.status} />}
              <span className="font-semibold text-foreground">{c.oab}/{c.uf}</span>
              <span className="text-muted-foreground/80">·</span>
              <span>
                <span className={cn('font-medium', c.novas > 0 && 'text-foreground')}>{c.novas}</span> nova
                {c.novas === 1 ? '' : 's'} de {c.total}
              </span>
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

function StatusPonto({ status }: { status: UltimaCaptura['status'] }) {
  const cor =
    status === 'sucesso' ? 'bg-success' : status === 'parcial' ? 'bg-warning' : 'bg-destructive'
  const rotulo =
    status === 'sucesso' ? 'Captura com sucesso' : status === 'parcial' ? 'Captura parcial' : 'Falha na captura'
  return <span className={cn('h-2 w-2 shrink-0 rounded-full', cor)} title={rotulo} aria-label={rotulo} />
}
