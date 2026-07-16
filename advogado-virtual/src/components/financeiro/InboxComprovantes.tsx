'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import {
  Inbox, FileText, ExternalLink, MessageSquare, HandCoins, Trash2, User, Phone, ScanLine, AlertTriangle,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { ConfirmDialog } from '@/components/ui/dialog'
import { useToast } from '@/components/ui/toast'
import { formatarValor } from '@/lib/financeiro/parcelas'
import { AtribuirComprovanteModal } from './AtribuirComprovanteModal'
import { DetalheComprovanteModal } from './DetalheComprovanteModal'

// ─────────────────────────────────────────────────────────────
// Contrato consumido (rota GET /api/financeiro/comprovantes):
//   { comprovantes: ComprovanteRecebido[], total: number }
// Cada item traz uma signed URL inline (imagemUrl) do arquivo em bucket
// privado — igual ao padrão do /comprovante-pendente. LGPD: nunca logamos os
// valores/nomes de `dados` aqui (só usamos na tela).
// ─────────────────────────────────────────────────────────────

export interface DadosComprovante {
  valorCentavos: number
  dataISO: string
  pagadorNome?: string
  banco?: string
  endToEndId?: string
  contentType?: string
}

export interface ComprovanteRecebido {
  id: string
  cliente_id: string | null
  cliente_nome: string | null
  telefone: string
  conversa_id: string | null
  dados: DadosComprovante
  content_type: string | null
  imagemUrl: string | null   // signed URL inline (nova aba / <img>); null se indisponível
  downloadUrl: string | null // signed URL que força download (Content-Disposition attachment)
  criado_em: string
  status: string
  possivelDuplicado?: boolean // rota marca quando outro item divide o mesmo E2E (ou valor+data+telefone)
}

/** "2026-07-11T…" | "2026-07-11" -> "11/07/2026" (fallback: original). */
function dataPtBr(iso: string | undefined): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso ?? '')
  return m ? `${m[3]}/${m[2]}/${m[1]}` : (iso ?? '—')
}

/**
 * Inbox de comprovantes recebidos por WhatsApp SEM cobrança correspondente
 * (migration 053). Fica no topo do /financeiro, visível só quando há pendentes.
 * O atendente confere e ATRIBUI (clique = confirmação humana da baixa) ou
 * descarta. Recarrega a própria lista após cada ação e avisa o pai (onChange)
 * para atualizar as parcelas/indicadores.
 */
export function InboxComprovantes({ onChange }: { onChange?: () => void }) {
  const { info, error: toastError } = useToast()

  const [itens, setItens]     = useState<ComprovanteRecebido[]>([])
  const [total, setTotal]     = useState(0)
  const [loading, setLoading] = useState(true)

  const [detalhe, setDetalhe]             = useState<ComprovanteRecebido | null>(null)
  const [atribuir, setAtribuir]           = useState<ComprovanteRecebido | null>(null)
  const [descartarAlvo, setDescartarAlvo] = useState<ComprovanteRecebido | null>(null)
  const [descartando, setDescartando]     = useState(false)

  const carregar = useCallback(async () => {
    setLoading(true)
    try {
      const r = await fetch('/api/financeiro/comprovantes')
      const d = await r.json().catch(() => ({}))
      if (!r.ok) { setItens([]); setTotal(0); return }
      const lista: ComprovanteRecebido[] = d.comprovantes ?? d.data ?? []
      setItens(lista)
      setTotal(Number(d.total ?? lista.length))
    } catch {
      setItens([]); setTotal(0)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { carregar() }, [carregar])

  // Recarrega o inbox E avisa o pai (parcelas mudaram por baixa/nova cobrança).
  function aposAtribuir() {
    setAtribuir(null)
    carregar()
    onChange?.()
  }

  async function descartar() {
    if (!descartarAlvo || descartando) return
    setDescartando(true)
    try {
      const r = await fetch(`/api/financeiro/comprovantes/${descartarAlvo.id}/descartar`, { method: 'POST' })
      const d = await r.json().catch(() => ({}))
      if (!r.ok) { toastError('Não foi possível descartar', d.error ?? 'Tente novamente.'); return }
      info('Comprovante descartado', 'Removido da fila de atribuição.')
      setDescartarAlvo(null)
      carregar()
      onChange?.()
    } catch {
      toastError('Não foi possível descartar', 'Falha de rede. Tente novamente.')
    } finally {
      setDescartando(false)
    }
  }

  // Enquanto carrega pela primeira vez OU quando não há pendentes: não ocupa
  // espaço no topo (a seção é auxiliar e só aparece quando há o que atribuir).
  if (loading && itens.length === 0) return null
  if (total === 0 || itens.length === 0) return null

  return (
    <section className="rounded-xl border border-warning/40 bg-warning/5">
      <header className="flex items-center gap-2 border-b border-warning/30 px-4 py-3">
        <Inbox className="h-4 w-4 text-warning" aria-hidden />
        <h2 className="text-sm font-semibold text-warning">
          Comprovantes recebidos — aguardando atribuição ({total})
        </h2>
        {loading && <Spinner className="ml-1 h-3.5 w-3.5 text-warning" />}
      </header>

      <ul className="divide-y divide-warning/20">
        {itens.map((c) => (
          // Linha inteira clicável = abre o detalhe. Os controles internos
          // (miniatura, links, botões) chamam stopPropagation p/ agir sem abrir o
          // detalhe. role/tabIndex/onKeyDown mantêm o acesso por teclado.
          <li
            key={c.id}
            onClick={() => setDetalhe(c)}
            // Só quando a PRÓPRIA linha está focada (target === li). Assim o
            // keydown de Enter/Espaço num botão/link interno (que bolha até aqui)
            // não abre o detalhe por cima da ação — o stopPropagation do onClick
            // cobre só o clique, não o teclado.
            onKeyDown={(e) => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); setDetalhe(c) } }}
            role="button"
            tabIndex={0}
            aria-label={`Ver detalhe do comprovante de ${formatarValor(c.dados?.valorCentavos ?? 0)}`}
            className="flex cursor-pointer flex-col gap-3 p-3 transition-colors hover:bg-warning/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-warning/40 sm:flex-row sm:items-center"
          >
            {/* Miniatura clicável (nova aba). PDF/sem imagem -> ícone. */}
            <div className="shrink-0" onClick={(e) => e.stopPropagation()}>
              <Miniatura comprovante={c} />
            </div>

            {/* Dados extraídos + origem */}
            <div className="min-w-0 flex-1 space-y-1">
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
                <span className="text-base font-bold tabular-nums text-foreground">
                  {formatarValor(c.dados?.valorCentavos ?? 0)}
                </span>
                <span className="text-sm text-muted-foreground">{dataPtBr(c.dados?.dataISO)}</span>
                {c.possivelDuplicado && (
                  <span
                    title="Mesmo comprovante recebido em outra mensagem — confira e descarte um dos dois."
                    className="inline-flex items-center gap-1 self-center rounded-full border border-warning/40 bg-warning/15 px-2 py-0.5 text-[11px] font-medium text-warning"
                  >
                    <AlertTriangle className="h-3 w-3" aria-hidden /> Possível duplicado
                  </span>
                )}
              </div>
              {(c.dados?.pagadorNome || c.dados?.banco) && (
                <p className="flex items-center gap-1.5 truncate text-xs text-muted-foreground">
                  <ScanLine className="h-3.5 w-3.5 shrink-0" aria-hidden />
                  {[c.dados?.pagadorNome, c.dados?.banco].filter(Boolean).join(' · ')}
                </p>
              )}
              <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
                {c.cliente_id ? (
                  <Link href={`/clientes/${c.cliente_id}`} onClick={(e) => e.stopPropagation()} className="inline-flex items-center gap-1 font-medium text-foreground hover:text-primary hover:underline">
                    <User className="h-3.5 w-3.5" aria-hidden /> {c.cliente_nome ?? 'Cliente'}
                  </Link>
                ) : (
                  <span className="inline-flex items-center gap-1 italic">
                    <User className="h-3.5 w-3.5" aria-hidden /> Cliente não identificado
                  </span>
                )}
                <span className="inline-flex items-center gap-1">
                  <Phone className="h-3.5 w-3.5" aria-hidden /> {c.telefone}
                </span>
                {c.conversa_id && (
                  <Link
                    href={`/conversas?conversa=${encodeURIComponent(c.conversa_id)}`}
                    onClick={(e) => e.stopPropagation()}
                    className="inline-flex items-center gap-1 text-primary hover:underline"
                  >
                    <MessageSquare className="h-3.5 w-3.5" aria-hidden /> Ver conversa
                  </Link>
                )}
              </p>
            </div>

            {/* Ações (stopPropagation: agir sem abrir o detalhe da linha) */}
            <div className="flex shrink-0 items-center gap-2" onClick={(e) => e.stopPropagation()}>
              <Button size="sm" onClick={() => setAtribuir(c)}>
                <HandCoins className="h-4 w-4" /> Atribuir
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setDescartarAlvo(c)} className="text-destructive hover:bg-destructive/10">
                <Trash2 className="h-4 w-4" /> Descartar
              </Button>
            </div>
          </li>
        ))}
      </ul>

      {/* Detalhe do comprovante: Atribuir/Descartar fecham o detalhe e reusam os
          fluxos já montados abaixo (o modal de atribuição / o diálogo de descarte). */}
      <DetalheComprovanteModal
        comprovante={detalhe}
        onClose={() => setDetalhe(null)}
        onAtribuir={() => { const c = detalhe; setDetalhe(null); setAtribuir(c) }}
        onDescartar={() => { const c = detalhe; setDetalhe(null); setDescartarAlvo(c) }}
      />

      <AtribuirComprovanteModal
        comprovante={atribuir}
        onClose={() => setAtribuir(null)}
        onDone={aposAtribuir}
      />

      <ConfirmDialog
        open={Boolean(descartarAlvo)}
        onClose={() => setDescartarAlvo(null)}
        onConfirm={descartar}
        loading={descartando}
        variant="danger"
        title="Descartar comprovante"
        confirmLabel="Descartar"
        cancelLabel="Voltar"
        description={
          descartarAlvo ? (
            <>
              O comprovante de <strong>{formatarValor(descartarAlvo.dados?.valorCentavos ?? 0)}</strong> sairá
              da fila de atribuição. Use isto quando não for um comprovante válido ou for duplicado.
            </>
          ) : ''
        }
      />
    </section>
  )
}

// ─────────────────────────────────────────────────────────────
// Miniatura do arquivo (abre em nova aba). PDF/sem imagem -> ícone.
// ─────────────────────────────────────────────────────────────

function Miniatura({ comprovante }: { comprovante: ComprovanteRecebido }) {
  const [imgErro, setImgErro] = useState(false)
  const ehPdf = (comprovante.content_type ?? comprovante.dados?.contentType ?? '').includes('pdf')
  const url = comprovante.imagemUrl

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
        alt="Comprovante recebido"
        onError={() => setImgErro(true)}
        className="h-full w-full object-cover"
      />
      <span className="absolute inset-0 hidden items-center justify-center bg-black/40 group-hover:flex">
        <ExternalLink className="h-4 w-4 text-white" aria-hidden />
      </span>
    </a>
  )
}
