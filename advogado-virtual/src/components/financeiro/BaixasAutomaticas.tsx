'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { Zap, FileText, ExternalLink, User, Undo2, Info } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { ConfirmDialog } from '@/components/ui/dialog'
import { useToast } from '@/components/ui/toast'
import { formatarValor } from '@/lib/financeiro/parcelas'
import { formatarData, formatarDataRelativa } from '@/lib/utils'

// ─────────────────────────────────────────────────────────────
// Painel/AVISO de BAIXAS AUTOMÁTICAS (migration 077). Fica no topo do
// /financeiro, visível só quando o SISTEMA baixou parcelas sozinho numa janela
// recente (rota GET /api/financeiro/baixas-automaticas). Destaque visual
// distinto (tom "success") + contador para o dono conferir SEM caçar; cada item
// tem DESFAZER (admin/advogado) que reverte a baixa e devolve o comprovante à
// conferência humana. LGPD: nunca logamos valores/nomes aqui.
// ─────────────────────────────────────────────────────────────

interface BaixaAutomatica {
  id: string
  cliente_id: string
  cliente_nome: string | null
  descricao: string
  valor_centavos: number
  pago_valor_centavos: number | null
  vencimento: string
  pago_em: string | null
  dados: { valorCentavos?: number; dataISO?: string; pagadorNome?: string; banco?: string } | null
  imagemUrl: string | null
  content_type: string | null
}

/** "2026-07-11T…" | "2026-07-11" -> "11/07/2026" (fallback: original). */
function dataPtBr(iso: string | null | undefined): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso ?? '')
  return m ? `${m[3]}/${m[2]}/${m[1]}` : (iso ?? '—')
}

export function BaixasAutomaticas({
  podeDesfazer,
  onChange,
}: {
  podeDesfazer: boolean
  onChange?: () => void
}) {
  const { success, error: toastError } = useToast()

  const [itens, setItens] = useState<BaixaAutomatica[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [desfazerAlvo, setDesfazerAlvo] = useState<BaixaAutomatica | null>(null)
  const [desfazendo, setDesfazendo] = useState(false)

  const carregar = useCallback(async () => {
    setLoading(true)
    try {
      const r = await fetch('/api/financeiro/baixas-automaticas')
      const d = await r.json().catch(() => ({}))
      if (!r.ok) { setItens([]); setTotal(0); return }
      const lista: BaixaAutomatica[] = d.baixas ?? []
      setItens(lista)
      setTotal(Number(d.total ?? lista.length))
    } catch {
      setItens([]); setTotal(0)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { carregar() }, [carregar])

  async function desfazer() {
    if (!desfazerAlvo || desfazendo) return
    setDesfazendo(true)
    try {
      const r = await fetch(`/api/financeiro/parcelas/${desfazerAlvo.id}/desfazer-automatica`, { method: 'POST' })
      const d = await r.json().catch(() => ({}))
      if (!r.ok) {
        toastError('Não foi possível desfazer', d.error ?? 'Tente novamente.')
        // 409 = já desfeita/alterada por outra sessão → recarrega para sumir a linha.
        if (r.status === 409) { setDesfazerAlvo(null); carregar(); onChange?.() }
        return
      }
      success('Baixa desfeita', 'A parcela voltou a ficar em aberto, aguardando conferência.')
      setDesfazerAlvo(null)
      carregar()
      onChange?.()
    } catch {
      toastError('Não foi possível desfazer', 'Falha de rede. Tente novamente.')
    } finally {
      setDesfazendo(false)
    }
  }

  // Aparece só quando há baixas automáticas recentes (aviso auxiliar do topo).
  if (loading && itens.length === 0) return null
  if (total === 0 || itens.length === 0) return null

  return (
    <section className="rounded-xl border border-success/40 bg-success/5">
      <header className="flex items-center gap-2 border-b border-success/30 px-4 py-3">
        <Zap className="h-4 w-4 text-success" aria-hidden />
        <h2 className="text-sm font-semibold text-success">
          Baixas automáticas — confira ({total})
        </h2>
        {loading && <Spinner className="ml-1 h-3.5 w-3.5 text-success" />}
      </header>

      <div className="flex items-start gap-2 border-b border-success/20 px-4 py-2 text-xs text-muted-foreground">
        <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
        <span>
          O comprovante chegou pelo WhatsApp, o recebedor é o escritório e o valor bateu
          com exatamente uma cobrança em aberto — por isso a baixa foi dada automaticamente.
          {podeDesfazer ? ' Se algo estiver errado, use Desfazer.' : ''}
        </span>
      </div>

      <ul className="divide-y divide-success/20">
        {itens.map((b) => (
          <li key={b.id} className="flex flex-col gap-3 p-3 sm:flex-row sm:items-center">
            {/* Miniatura do comprovante (abre em nova aba). PDF/sem imagem -> ícone. */}
            <div className="shrink-0">
              <Miniatura baixa={b} />
            </div>

            {/* Dados da baixa */}
            <div className="min-w-0 flex-1 space-y-1">
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
                <span className="text-base font-bold tabular-nums text-foreground">
                  {formatarValor(b.pago_valor_centavos ?? b.valor_centavos)}
                </span>
                <span className="inline-flex items-center gap-1 rounded-full border border-success/40 bg-success/15 px-2 py-0.5 text-[11px] font-medium text-success">
                  <Zap className="h-3 w-3" aria-hidden /> Baixa automática
                </span>
                <span className="text-sm text-muted-foreground" title="Data do pagamento">
                  pago em {dataPtBr(b.pago_em)}
                </span>
                {b.pago_em && (
                  <span className="text-xs text-muted-foreground/80">· {formatarDataRelativa(b.pago_em)}</span>
                )}
              </div>
              <p className="truncate text-xs text-muted-foreground" title={b.descricao}>{b.descricao}</p>
              <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
                <Link
                  href={`/clientes/${b.cliente_id}`}
                  className="inline-flex items-center gap-1 font-medium text-foreground hover:text-primary hover:underline"
                >
                  <User className="h-3.5 w-3.5" aria-hidden /> {b.cliente_nome ?? 'Cliente'}
                </Link>
                <span className="text-muted-foreground/70">· vence {formatarData(b.vencimento)}</span>
              </p>
            </div>

            {/* Ação: DESFAZER (só admin/advogado) */}
            {podeDesfazer && (
              <div className="flex shrink-0 items-center">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setDesfazerAlvo(b)}
                  className="text-destructive hover:bg-destructive/10"
                >
                  <Undo2 className="h-4 w-4" /> Desfazer
                </Button>
              </div>
            )}
          </li>
        ))}
      </ul>

      <ConfirmDialog
        open={Boolean(desfazerAlvo)}
        onClose={() => setDesfazerAlvo(null)}
        onConfirm={desfazer}
        loading={desfazendo}
        variant="danger"
        title="Desfazer baixa automática"
        confirmLabel="Desfazer baixa"
        cancelLabel="Voltar"
        description={
          desfazerAlvo ? (
            <>
              A baixa de <strong>{formatarValor(desfazerAlvo.pago_valor_centavos ?? desfazerAlvo.valor_centavos)}</strong>{' '}
              será desfeita: a parcela volta a ficar <strong>em aberto</strong> e o comprovante
              retorna à fila de conferência (aguardando baixa) para revisão humana.
            </>
          ) : ''
        }
      />
    </section>
  )
}

// ─────────────────────────────────────────────────────────────
// Miniatura do comprovante (abre em nova aba). PDF/sem imagem -> ícone.
// ─────────────────────────────────────────────────────────────

function Miniatura({ baixa }: { baixa: BaixaAutomatica }) {
  const [imgErro, setImgErro] = useState(false)
  const ehPdf = (baixa.content_type ?? '').includes('pdf')
  const url = baixa.imagemUrl

  const base = 'flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-border bg-background'

  if (!url || ehPdf || imgErro) {
    const conteudo = (
      <span className={`${base} ${url ? 'hover:border-primary/50 transition-colors' : ''}`}>
        <FileText className="h-6 w-6 text-muted-foreground" aria-hidden />
      </span>
    )
    return url ? (
      <a href={url} target="_blank" rel="noopener noreferrer" title="Abrir comprovante (PDF)" className="shrink-0">
        {conteudo}
      </a>
    ) : conteudo
  }

  return (
    <a href={url} target="_blank" rel="noopener noreferrer" title="Abrir comprovante em nova aba" className={`${base} group relative cursor-zoom-in`}>
      {/* eslint-disable-next-line @next/next/no-img-element -- signed URL de bucket privado, não otimizável */}
      <img
        src={url}
        alt="Comprovante da baixa automática"
        onError={() => setImgErro(true)}
        className="h-full w-full object-cover"
      />
      <span className="absolute inset-0 hidden items-center justify-center bg-black/40 group-hover:flex">
        <ExternalLink className="h-4 w-4 text-white" aria-hidden />
      </span>
    </a>
  )
}
