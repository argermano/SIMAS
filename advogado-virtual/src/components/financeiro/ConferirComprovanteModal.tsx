'use client'

import { useCallback, useEffect, useState } from 'react'
import { AlertTriangle, Download, ExternalLink, RefreshCw, ScanLine } from 'lucide-react'
import { Dialog } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Select } from '@/components/ui/select'
import { Spinner } from '@/components/ui/spinner'
import { Input } from '@/components/ui/input'
import { useToast } from '@/components/ui/toast'
import { formatarData, formatarMoedaInput, moedaParaNumero } from '@/lib/utils'
import { formatarValor } from '@/lib/financeiro/parcelas'
import { type Parcela, LABELS_MEIO } from './tipos'

// Dados extraídos pela IA (mesma forma de DadosComprovante) + o contentType do
// arquivo salvo no staging. Vem do GET /comprovante-pendente.
interface DadosPendente {
  valorCentavos: number
  dataISO: string
  pagadorNome?: string
  banco?: string
  endToEndId?: string
  contentType?: string
}

interface Pendente {
  dados: DadosPendente
  imagemUrl: string | null    // inline (para <img>/nova aba)
  downloadUrl: string | null  // força download (Content-Disposition attachment)
  contentType: string | null
}

const MEIOS = Object.entries(LABELS_MEIO).map(([value, label]) => ({ value, label }))

/** "2026-07-01" -> "01/07/2026" (fallback: string original). */
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
 * Modal de conferência do comprovante recebido por WhatsApp (staging). Mostra o
 * arquivo + os dados extraídos e deixa o HUMANO decidir: confirmar a baixa
 * (POST /baixa reaproveitando o arquivo já no bucket) ou descartar ("não é
 * comprovante"). A IA apenas pré-organiza — a baixa nunca é automática.
 */
export function ConferirComprovanteModal({
  parcela,
  onClose,
  onDone,
}: {
  parcela: Parcela | null
  onClose: () => void
  onDone: () => void
}) {
  const { success, error: toastError, info } = useToast()

  const [carregando, setCarregando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [pendente, setPendente] = useState<Pendente | null>(null)
  const [meio, setMeio] = useState('pix')
  // Valor a dar baixa (editável): default = valor EXTRAÍDO pela IA, mas o humano
  // pode corrigir quando o OCR diverge do valor real (±1% do casamento).
  const [valor, setValor] = useState('')
  // Falha ao carregar a <img> da signed URL → mostra o fallback textual.
  const [imgErro, setImgErro] = useState(false)
  const [confirmando, setConfirmando] = useState(false)
  const [descartando, setDescartando] = useState(false)

  const carregar = useCallback(async (parcelaId: string) => {
    setCarregando(true)
    setErro(null)
    setPendente(null)
    try {
      const r = await fetch(`/api/financeiro/parcelas/${parcelaId}/comprovante-pendente`)
      const d = await r.json().catch(() => ({}))
      if (!r.ok) {
        setErro(mensagemErro(d, 'Não foi possível carregar o comprovante.'))
        return
      }
      const p = d as Pendente
      setPendente(p)
      setImgErro(false)
      // Semeia o campo editável com o valor extraído (centavos → input pt-BR).
      setValor(formatarMoedaInput(String(p.dados?.valorCentavos ?? 0)))
    } catch {
      setErro('Falha de rede ao carregar o comprovante.')
    } finally {
      setCarregando(false)
    }
  }, [])

  // Carrega ao abrir; zera ao fechar para uma próxima conferência limpa.
  useEffect(() => {
    if (parcela) void carregar(parcela.id)
    else {
      setPendente(null)
      setErro(null)
      setMeio('pix')
      setValor('')
      setImgErro(false)
    }
  }, [parcela, carregar])

  async function confirmarBaixa() {
    if (!parcela || !pendente || confirmando) return
    const { dados } = pendente
    // Valor efetivamente dado baixa: o do campo editável (default = extraído).
    const valorReais = moedaParaNumero(valor)
    if (!valorReais || valorReais <= 0) {
      toastError('Valor inválido', 'Informe o valor efetivamente pago.')
      return
    }
    const valorPagoCentavos = Math.round(valorReais * 100)
    setConfirmando(true)
    try {
      const r = await fetch(`/api/financeiro/parcelas/${parcela.id}/baixa`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          meio,
          pagoEm: dados.dataISO,
          valorPago: valorPagoCentavos,
          // Grava o valor conferido pelo humano nos dados do comprovante.
          comprovanteDados: { ...dados, valorCentavos: valorPagoCentavos },
          // Reaproveita o arquivo já salvo no bucket (a rota valida o prefixo
          // do tenant). Sem re-upload dos bytes.
          ...(parcela.comprovante_recebido_url ? { comprovanteUrl: parcela.comprovante_recebido_url } : {}),
        }),
      })
      const d = await r.json().catch(() => ({}))
      if (!r.ok) {
        toastError('Baixa não confirmada', mensagemErro(d, 'Não foi possível dar baixa na parcela.'))
        // 409 = a parcela já foi baixada/cancelada por outra pessoa: a linha e o
        // botão "Conferir" estão obsoletos → recarrega a lista (fecha o modal).
        if (r.status === 409) onDone()
        return
      }
      success('Baixa confirmada', `${parcela.descricao} — ${formatarValor(valorPagoCentavos)}`)
      onDone()
    } catch {
      toastError('Baixa não confirmada', 'Falha de rede. Tente novamente.')
    } finally {
      setConfirmando(false)
    }
  }

  async function descartar() {
    if (!parcela || descartando) return
    setDescartando(true)
    try {
      const r = await fetch(`/api/financeiro/parcelas/${parcela.id}/comprovante-pendente`, {
        method: 'DELETE',
      })
      const d = await r.json().catch(() => ({}))
      if (!r.ok) {
        toastError('Não foi possível descartar', mensagemErro(d, 'Tente novamente.'))
        // 409 = staging já consumido por baixa/cancelamento em outra sessão:
        // a linha está obsoleta → recarrega a lista (fecha o modal).
        if (r.status === 409) onDone()
        return
      }
      info('Comprovante descartado', 'A parcela voltou a ficar apenas em aberto.')
      onDone()
    } catch {
      toastError('Não foi possível descartar', 'Falha de rede. Tente novamente.')
    } finally {
      setDescartando(false)
    }
  }

  const dados = pendente?.dados
  const ehPdf = (pendente?.contentType ?? dados?.contentType ?? '').includes('pdf')
  const valorDivergente =
    !!dados && !!parcela && dados.valorCentavos !== parcela.valor_centavos

  return (
    <Dialog
      open={Boolean(parcela)}
      onClose={onClose}
      title="Conferir comprovante recebido"
      description={parcela ? `${parcela.cliente_nome ?? 'Cliente'} · ${parcela.descricao} · vence ${formatarData(parcela.vencimento)}` : undefined}
      size="lg"
      footer={
        <>
          <Button variant="secondary" size="md" onClick={descartar} loading={descartando} disabled={confirmando}>
            Não é comprovante
          </Button>
          <Button
            size="md"
            onClick={confirmarBaixa}
            loading={confirmando}
            disabled={!pendente || descartando}
          >
            Confirmar baixa
          </Button>
        </>
      }
    >
      {carregando ? (
        <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
          <Spinner className="h-4 w-4" /> Carregando comprovante…
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
      ) : pendente && dados ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {/* Arquivo recebido */}
          <div className="space-y-2">
            <div className="rounded-lg border border-border bg-muted/20 p-2">
              {!pendente.imagemUrl || (!ehPdf && imgErro) ? (
                // Sem URL OU a imagem falhou ao carregar (signed URL expirada,
                // arquivo corrompido, blip de rede): mostra o fallback textual em
                // vez do glifo de imagem quebrada, para não confundir a conferência.
                <p className="px-3 py-8 text-center text-sm text-muted-foreground">
                  Arquivo indisponível.
                </p>
              ) : ehPdf ? (
                <a
                  href={pendente.imagemUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center justify-center gap-2 rounded-md bg-background px-3 py-10 text-sm font-medium text-primary hover:underline"
                >
                  <ExternalLink className="h-4 w-4" /> Abrir comprovante (PDF)
                </a>
              ) : (
                <a href={pendente.imagemUrl} target="_blank" rel="noopener noreferrer" title="Abrir em tamanho real">
                  {/* eslint-disable-next-line @next/next/no-img-element -- signed URL de bucket privado, não otimizável */}
                  <img
                    src={pendente.imagemUrl}
                    alt="Comprovante recebido"
                    onError={() => setImgErro(true)}
                    className="max-h-96 w-full cursor-zoom-in rounded-md object-contain"
                  />
                </a>
              )}
            </div>
            {/* Ver o arquivo em tamanho real / baixar (LGPD: signed URLs curtas) */}
            {(pendente.imagemUrl || pendente.downloadUrl) && (
              <div className="flex flex-wrap gap-2">
                {pendente.imagemUrl && (
                  <Button asChild variant="secondary" size="sm">
                    <a href={pendente.imagemUrl} target="_blank" rel="noopener noreferrer">
                      <ExternalLink className="h-4 w-4" /> Abrir em tamanho real
                    </a>
                  </Button>
                )}
                {pendente.downloadUrl && (
                  <Button asChild variant="secondary" size="sm">
                    <a href={pendente.downloadUrl}>
                      <Download className="h-4 w-4" /> Baixar
                    </a>
                  </Button>
                )}
              </div>
            )}
          </div>

          {/* Dados extraídos + parcela */}
          <div className="space-y-3">
            <div className="rounded-lg border border-border bg-background px-3 py-2.5">
              <p className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                <ScanLine className="h-3.5 w-3.5" aria-hidden /> Dados extraídos
              </p>
              <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm">
                <div>
                  <dt className="text-xs text-muted-foreground">Valor</dt>
                  <dd className="font-semibold tabular-nums text-foreground">{formatarValor(dados.valorCentavos)}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">Data</dt>
                  <dd className="font-medium text-foreground">{dataPtBr(dados.dataISO)}</dd>
                </div>
                {dados.pagadorNome && (
                  <div className="col-span-2">
                    <dt className="text-xs text-muted-foreground">Pagador</dt>
                    <dd className="truncate font-medium text-foreground">{dados.pagadorNome}</dd>
                  </div>
                )}
                {dados.banco && (
                  <div>
                    <dt className="text-xs text-muted-foreground">Banco</dt>
                    <dd className="truncate font-medium text-foreground">{dados.banco}</dd>
                  </div>
                )}
                {dados.endToEndId && (
                  <div className="col-span-2">
                    <dt className="text-xs text-muted-foreground">End-to-end ID</dt>
                    <dd className="truncate font-mono text-xs text-foreground">{dados.endToEndId}</dd>
                  </div>
                )}
              </dl>
            </div>

            {/* Aviso de divergência de valor — a equipe decide */}
            {valorDivergente && parcela && (
              <div className="flex items-start gap-2 rounded-lg border border-warning/30 bg-warning/5 px-3 py-2 text-xs text-warning">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                <span>
                  O valor do comprovante ({formatarValor(dados.valorCentavos)}) difere do valor da parcela
                  ({formatarValor(parcela.valor_centavos)}). Confira antes de dar baixa.
                </span>
              </div>
            )}

            {parcela && (
              <div className="rounded-lg border border-border bg-muted/20 px-3 py-2.5 text-sm">
                <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Parcela</p>
                <p className="font-medium text-foreground">{parcela.descricao}</p>
                <p className="text-muted-foreground">
                  {formatarValor(parcela.valor_centavos)} · vence {formatarData(parcela.vencimento)}
                </p>
              </div>
            )}

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Input
                label="Valor a dar baixa"
                inputMode="numeric"
                value={valor}
                onChange={(e) => setValor(formatarMoedaInput(e.target.value))}
                hint={valorDivergente ? 'Ajuste se o OCR divergiu do pago.' : undefined}
              />
              <Select
                id="meio-conferir"
                label="Meio de pagamento"
                value={meio}
                onChange={(e) => setMeio(e.target.value)}
                options={MEIOS}
              />
            </div>
          </div>
        </div>
      ) : null}
    </Dialog>
  )
}
