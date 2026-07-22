'use client'

import { useCallback, useEffect, useState } from 'react'
import { Download, ExternalLink, FileText, RefreshCw, ScanLine, User, Zap, Undo2 } from 'lucide-react'
import { Dialog, ConfirmDialog } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { useToast } from '@/components/ui/toast'
import { formatarData } from '@/lib/utils'
import { formatarValor } from '@/lib/financeiro/parcelas'
import { type Parcela, LABELS_MEIO } from './tipos'

// Dados extraídos pela IA (mesma forma de DadosComprovante). Só chegam quando o
// comprovante foi processado — a baixa manual pode não ter nenhum.
interface DadosExtraidos {
  valorCentavos: number
  dataISO: string
  pagadorNome?: string
  banco?: string
  endToEndId?: string
}

interface Comprovante {
  url: string | null          // inline (para <img>/nova aba)
  downloadUrl: string | null  // força download (Content-Disposition attachment)
  contentType: string | null
}

interface Pagamento {
  parcela: { descricao: string; valorCentavos: number; vencimento: string }
  pagamento: {
    pagoEm: string | null
    valorPagoCentavos: number | null
    meio: string | null
    baixaPorNome: string | null
    obs: string | null
    baixaAutomatica?: boolean
  }
  dados: DadosExtraidos | null
  comprovante: Comprovante | null
}

/** "2026-07-01" (ou ISO com hora) → "01/07/2026". */
function dataPtBr(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso ?? '')
  return m ? `${m[3]}/${m[2]}/${m[1]}` : (iso ?? '')
}

function mensagemErro(data: unknown, fallback: string): string {
  if (data && typeof data === 'object' && 'error' in data) {
    const e = (data as { error?: unknown }).error
    if (typeof e === 'string' && e) return e
  }
  return fallback
}

/**
 * Modal "Ver pagamento" de uma parcela JÁ PAGA: mostra os dados da baixa (valor
 * pago, data, meio, quem confirmou, observação), os dados que a IA extraiu do
 * comprovante (quando houver) e o próprio comprovante — com preview generoso e
 * atalhos para abrir em tamanho real (nova aba) ou baixar o arquivo.
 */
export function PagamentoModal({
  parcela,
  onClose,
  podeDesfazer = false,
  onDesfeita,
}: {
  parcela: Parcela | null
  onClose: () => void
  // DESFAZER baixa automática (migration 077) — só quando a baixa foi automática
  // E o usuário é admin/advogado. onDesfeita recarrega a lista no pai.
  podeDesfazer?: boolean
  onDesfeita?: () => void
}) {
  const { success, error: toastError } = useToast()
  const [carregando, setCarregando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [dados, setDados] = useState<Pagamento | null>(null)
  // Falha ao carregar a <img> da signed URL → mostra o fallback textual.
  const [imgErro, setImgErro] = useState(false)
  const [confirmarDesfazer, setConfirmarDesfazer] = useState(false)
  const [desfazendo, setDesfazendo] = useState(false)

  const carregar = useCallback(async (parcelaId: string) => {
    setCarregando(true)
    setErro(null)
    setDados(null)
    try {
      const r = await fetch(`/api/financeiro/parcelas/${parcelaId}/pagamento`)
      const d = await r.json().catch(() => ({}))
      if (!r.ok) {
        setErro(mensagemErro(d, 'Não foi possível carregar o pagamento.'))
        return
      }
      setDados(d as Pagamento)
      setImgErro(false)
    } catch {
      setErro('Falha de rede ao carregar o pagamento.')
    } finally {
      setCarregando(false)
    }
  }, [])

  // Carrega ao abrir; zera ao fechar para uma próxima abertura limpa.
  useEffect(() => {
    if (parcela) void carregar(parcela.id)
    else {
      setDados(null)
      setErro(null)
      setImgErro(false)
    }
  }, [parcela, carregar])

  const pag = dados?.pagamento
  const ext = dados?.dados
  const comp = dados?.comprovante
  const ehPdf = (comp?.contentType ?? '').includes('pdf')
  const ehAutomatica = pag?.baixaAutomatica === true

  async function desfazer() {
    if (!parcela || desfazendo) return
    setDesfazendo(true)
    try {
      const r = await fetch(`/api/financeiro/parcelas/${parcela.id}/desfazer-automatica`, { method: 'POST' })
      const d = await r.json().catch(() => ({}))
      if (!r.ok) {
        toastError('Não foi possível desfazer', mensagemErro(d, 'Tente novamente.'))
        // 409 = já desfeita/alterada em outra sessão → fecha e recarrega.
        if (r.status === 409) { setConfirmarDesfazer(false); onDesfeita?.() }
        return
      }
      success('Baixa desfeita', 'A parcela voltou a ficar em aberto, aguardando conferência.')
      setConfirmarDesfazer(false)
      onDesfeita?.()
    } catch {
      toastError('Não foi possível desfazer', 'Falha de rede. Tente novamente.')
    } finally {
      setDesfazendo(false)
    }
  }

  return (
    <>
      <Dialog
      open={Boolean(parcela)}
      onClose={onClose}
      title="Pagamento da parcela"
      description={
        parcela
          ? `${parcela.cliente_nome ?? 'Cliente'} · ${parcela.descricao}`
          : undefined
      }
      size="lg"
      footer={
        <>
          {/* DESFAZER só aparece numa baixa AUTOMÁTICA e p/ admin/advogado. */}
          {ehAutomatica && podeDesfazer && (
            <Button
              variant="ghost"
              size="md"
              onClick={() => setConfirmarDesfazer(true)}
              className="mr-auto text-destructive hover:bg-destructive/10"
            >
              <Undo2 className="h-4 w-4" /> Desfazer baixa
            </Button>
          )}
          <Button variant="secondary" size="md" onClick={onClose}>
            Fechar
          </Button>
        </>
      }
    >
      {carregando ? (
        <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
          <Spinner className="h-4 w-4" /> Carregando pagamento…
        </div>
      ) : erro ? (
        <div className="space-y-3 py-6 text-center">
          <p className="text-sm text-muted-foreground">{erro}</p>
          {parcela && (
            <Button variant="ghost" size="sm" onClick={() => void carregar(parcela.id)}>
              <RefreshCw className="h-4 w-4" /> Tentar de novo
            </Button>
          )}
        </div>
      ) : dados && pag ? (
        <div className="space-y-4">
          {/* Destaque: esta baixa foi AUTOMÁTICA (migration 077) */}
          {ehAutomatica && (
            <div className="flex items-start gap-2 rounded-lg border border-success/40 bg-success/10 px-3 py-2 text-sm text-success">
              <Zap className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
              <span>
                Baixa dada <strong>automaticamente</strong> pelo sistema: comprovante do WhatsApp com
                recebedor do escritório e valor casando exatamente esta cobrança.
                {podeDesfazer ? ' Confira e, se necessário, use “Desfazer baixa”.' : ''}
              </span>
            </div>
          )}

          {/* Bloco Pagamento */}
          <div className="rounded-lg border border-border bg-background px-4 py-3">
            <div className="flex items-end justify-between gap-3">
              <div>
                <p className="text-xs text-muted-foreground">Valor pago</p>
                <p className="text-2xl font-bold tabular-nums text-success">
                  {formatarValor(pag.valorPagoCentavos ?? dados.parcela.valorCentavos)}
                </p>
              </div>
              <div className="text-right">
                <p className="text-xs text-muted-foreground">Data do pagamento</p>
                <p className="font-semibold tabular-nums text-foreground">
                  {pag.pagoEm ? formatarData(pag.pagoEm) : '—'}
                </p>
              </div>
            </div>
            <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 border-t border-border pt-3 text-sm">
              <div>
                <dt className="text-xs text-muted-foreground">Meio</dt>
                <dd className="font-medium text-foreground">
                  {pag.meio ? LABELS_MEIO[pag.meio] ?? pag.meio : '—'}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Confirmado por</dt>
                <dd className="flex items-center gap-1.5 font-medium text-foreground">
                  {ehAutomatica ? (
                    <><Zap className="h-3.5 w-3.5 text-success" aria-hidden /> Sistema (automática)</>
                  ) : (
                    <><User className="h-3.5 w-3.5 text-muted-foreground" aria-hidden /> {pag.baixaPorNome ?? '—'}</>
                  )}
                </dd>
              </div>
              {pag.obs && (
                <div className="col-span-2">
                  <dt className="text-xs text-muted-foreground">Observação</dt>
                  <dd className="whitespace-pre-wrap text-foreground">{pag.obs}</dd>
                </div>
              )}
            </dl>
          </div>

          {/* Bloco Dados extraídos pela IA (só quando houver) */}
          {ext && (
            <div className="rounded-lg border border-border bg-muted/20 px-4 py-3">
              <p className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                <ScanLine className="h-3.5 w-3.5" aria-hidden /> Dados extraídos pela IA
              </p>
              <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                <div>
                  <dt className="text-xs text-muted-foreground">Valor</dt>
                  <dd className="font-semibold tabular-nums text-foreground">{formatarValor(ext.valorCentavos)}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">Data</dt>
                  <dd className="font-medium text-foreground">{dataPtBr(ext.dataISO)}</dd>
                </div>
                {ext.pagadorNome && (
                  <div className="col-span-2">
                    <dt className="text-xs text-muted-foreground">Pagador</dt>
                    <dd className="truncate font-medium text-foreground">{ext.pagadorNome}</dd>
                  </div>
                )}
                {ext.banco && (
                  <div>
                    <dt className="text-xs text-muted-foreground">Banco</dt>
                    <dd className="truncate font-medium text-foreground">{ext.banco}</dd>
                  </div>
                )}
                {ext.endToEndId && (
                  <div className="col-span-2">
                    <dt className="text-xs text-muted-foreground">End-to-end ID</dt>
                    <dd className="truncate font-mono text-xs text-foreground">{ext.endToEndId}</dd>
                  </div>
                )}
              </dl>
            </div>
          )}

          {/* Bloco Comprovante */}
          {comp ? (
            <div className="space-y-2">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Comprovante</p>
              <div className="rounded-lg border border-border bg-muted/20 p-2">
                {!comp.url || (!ehPdf && imgErro) ? (
                  <p className="px-3 py-8 text-center text-sm text-muted-foreground">
                    Arquivo indisponível.
                  </p>
                ) : ehPdf ? (
                  <a
                    href={comp.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center justify-center gap-2 rounded-md bg-background px-3 py-10 text-sm font-medium text-primary hover:underline"
                  >
                    <FileText className="h-5 w-5" /> Abrir comprovante (PDF)
                  </a>
                ) : (
                  <a href={comp.url} target="_blank" rel="noopener noreferrer" title="Abrir em tamanho real">
                    {/* eslint-disable-next-line @next/next/no-img-element -- signed URL de bucket privado, não otimizável */}
                    <img
                      src={comp.url}
                      alt="Comprovante do pagamento"
                      onError={() => setImgErro(true)}
                      className="max-h-96 w-full cursor-zoom-in rounded-md object-contain"
                    />
                  </a>
                )}
              </div>
              <div className="flex flex-wrap gap-2">
                {comp.url && (
                  <Button asChild variant="secondary" size="sm">
                    <a href={comp.url} target="_blank" rel="noopener noreferrer">
                      <ExternalLink className="h-4 w-4" /> Abrir em tamanho real
                    </a>
                  </Button>
                )}
                {comp.downloadUrl && (
                  <Button asChild variant="secondary" size="sm">
                    <a href={comp.downloadUrl}>
                      <Download className="h-4 w-4" /> Baixar
                    </a>
                  </Button>
                )}
              </div>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">Baixa sem comprovante anexado.</p>
          )}
        </div>
      ) : null}
      </Dialog>

      <ConfirmDialog
        open={confirmarDesfazer}
        onClose={() => setConfirmarDesfazer(false)}
        onConfirm={desfazer}
        loading={desfazendo}
        variant="danger"
        title="Desfazer baixa automática"
        confirmLabel="Desfazer baixa"
        cancelLabel="Voltar"
        description={
          parcela ? (
            <>
              A baixa de <strong>{formatarValor(pag?.valorPagoCentavos ?? parcela.valor_centavos)}</strong> será
              desfeita: a parcela volta a ficar <strong>em aberto</strong> e o comprovante retorna à fila de
              conferência (aguardando baixa) para revisão humana.
            </>
          ) : ''
        }
      />
    </>
  )
}
