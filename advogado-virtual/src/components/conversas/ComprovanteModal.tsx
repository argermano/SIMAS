'use client'

import { useCallback, useEffect, useState } from 'react'
import { RefreshCw, ScanLine } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog } from '@/components/ui/dialog'
import { Select } from '@/components/ui/select'
import { Spinner } from '@/components/ui/spinner'
import { useToast } from '@/components/ui/toast'
import { cn } from '@/lib/utils'
import { formatarValor } from '@/lib/financeiro/parcelas'
import type { DadosComprovante } from '@/lib/financeiro/comprovante'

/** Parcela aberta como devolvida por POST /api/financeiro/comprovante. */
interface ParcelaAberta {
  id: string
  descricao: string
  valor_centavos: number
  vencimento: string // yyyy-mm-dd
}

interface ResultadoLeitura {
  dados: DadosComprovante
  sugestao: ParcelaAberta | null
  alternativas: ParcelaAberta[]
}

// Espelha as guardas da rota /api/financeiro/parcelas/[id]/baixa: só anexa o
// arquivo quando o tipo é aceito e cabe no limite (senão a baixa segue sem ele).
const CONTENT_TYPES_ACEITOS = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'application/pdf',
])
const MAX_COMPROVANTE_BASE64 = 14 * 1024 * 1024

const MEIOS = [
  { value: 'pix', label: 'Pix' },
  { value: 'transferencia', label: 'Transferência' },
  { value: 'boleto', label: 'Boleto' },
  { value: 'dinheiro', label: 'Dinheiro' },
  { value: 'outro', label: 'Outro' },
]

/** "2026-07-01" -> "01/07/2026" (fallback: string original). */
function dataPtBr(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso)
  return m ? `${m[3]}/${m[2]}/${m[1]}` : iso
}

function mensagemErro(data: unknown, fallback: string): string {
  if (data && typeof data === 'object' && 'error' in data) {
    const e = (data as { error?: unknown }).error
    if (typeof e === 'string' && e) return e
  }
  return fallback
}

/** Blob -> base64 (sem data: prefix), em blocos para não estourar a pilha. */
async function blobParaBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer())
  let bin = ''
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  }
  return btoa(bin)
}

/**
 * Modal "Ler comprovante (IA)" das Conversas: envia a imagem recebida para
 * POST /api/financeiro/comprovante, mostra os dados extraídos + a parcela
 * sugerida (e alternativas) e deixa o HUMANO confirmar a baixa — a IA apenas
 * sugere, nunca dá baixa sozinha (invariante do módulo Financeiro).
 */
export function ComprovanteModal({
  aberto,
  conversaId,
  anexoUrl,
  telefone,
  onFechar,
}: {
  aberto: boolean
  conversaId: number
  anexoUrl: string
  telefone: string | null
  onFechar: () => void
}) {
  const { success, error: toastError } = useToast()

  const [lendo, setLendo] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [resultado, setResultado] = useState<ResultadoLeitura | null>(null)
  const [parcelaId, setParcelaId] = useState<string | null>(null)
  const [meio, setMeio] = useState('pix')
  const [confirmando, setConfirmando] = useState(false)

  const ler = useCallback(async () => {
    setLendo(true)
    setErro(null)
    setResultado(null)
    setParcelaId(null)
    try {
      const r = await fetch('/api/financeiro/comprovante', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ conversaId, anexoUrl, telefone }),
      })
      const d = await r.json().catch(() => ({}))
      if (!r.ok) {
        setErro(mensagemErro(d, 'Não foi possível ler o comprovante. Tente novamente.'))
        return
      }
      const res = d as ResultadoLeitura
      setResultado(res)
      setParcelaId(res.sugestao?.id ?? null)
    } catch {
      setErro('Falha de rede ao ler o comprovante.')
    } finally {
      setLendo(false)
    }
  }, [conversaId, anexoUrl, telefone])

  // Lê ao abrir (e zera tudo ao fechar, para uma releitura limpa depois).
  useEffect(() => {
    if (aberto) void ler()
    else {
      setResultado(null)
      setErro(null)
      setParcelaId(null)
      setMeio('pix')
    }
  }, [aberto, ler])

  async function confirmarBaixa() {
    if (!resultado || !parcelaId || confirmando) return
    setConfirmando(true)
    try {
      // Best-effort: anexa os bytes do comprovante à baixa (o proxy pode estar
      // desligado no relay — nesse caso a baixa segue sem o arquivo).
      let comprovanteBase64: string | undefined
      let contentType: string | undefined
      try {
        const img = await fetch(`/api/conversas/anexos?url=${encodeURIComponent(anexoUrl)}`)
        if (img.ok) {
          const blob = await img.blob()
          const tipo = (blob.type || img.headers.get('Content-Type') || 'image/jpeg')
            .split(';')[0]
            .trim()
          const base64 = await blobParaBase64(blob)
          if (CONTENT_TYPES_ACEITOS.has(tipo) && base64.length <= MAX_COMPROVANTE_BASE64) {
            comprovanteBase64 = base64
            contentType = tipo
          }
        }
      } catch {
        /* segue sem o arquivo */
      }

      const r = await fetch(`/api/financeiro/parcelas/${parcelaId}/baixa`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          meio,
          pagoEm: resultado.dados.dataISO,
          valorPago: resultado.dados.valorCentavos,
          comprovanteDados: resultado.dados,
          ...(comprovanteBase64 ? { comprovanteBase64, contentType } : {}),
        }),
      })
      const d = await r.json().catch(() => ({}))
      if (!r.ok) {
        toastError('Baixa não confirmada', mensagemErro(d, 'Não foi possível dar baixa na parcela.'))
        return
      }
      success('Baixa confirmada', 'A parcela foi marcada como paga.')
      onFechar()
    } catch {
      toastError('Baixa não confirmada', 'Falha de rede. Tente novamente.')
    } finally {
      setConfirmando(false)
    }
  }

  const candidatas: { parcela: ParcelaAberta; sugerida: boolean }[] = resultado
    ? [
        ...(resultado.sugestao ? [{ parcela: resultado.sugestao, sugerida: true }] : []),
        ...resultado.alternativas
          .filter((p) => p.id !== resultado.sugestao?.id)
          .map((p) => ({ parcela: p, sugerida: false })),
      ]
    : []

  return (
    <Dialog
      open={aberto}
      onClose={onFechar}
      title="Ler comprovante (IA)"
      description="A IA extrai os dados e sugere a parcela — a baixa só acontece com a sua confirmação."
      footer={
        <>
          <Button variant="secondary" size="md" onClick={onFechar} disabled={confirmando}>
            Não é comprovante
          </Button>
          <Button
            variant="default"
            size="md"
            onClick={confirmarBaixa}
            loading={confirmando}
            disabled={!resultado || !parcelaId}
            title={parcelaId ? 'Confirmar a baixa da parcela selecionada' : 'Selecione uma parcela'}
          >
            Confirmar baixa
          </Button>
        </>
      }
    >
      {lendo ? (
        <div className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
          <Spinner className="h-4 w-4" /> Lendo o comprovante…
        </div>
      ) : erro ? (
        <div className="space-y-3 py-4 text-center">
          <p className="text-sm text-muted-foreground">{erro}</p>
          <Button variant="ghost" size="sm" onClick={() => void ler()}>
            <RefreshCw className="h-4 w-4" /> Tentar de novo
          </Button>
        </div>
      ) : resultado ? (
        <div className="space-y-4">
          {/* Dados extraídos */}
          <div className="rounded-lg border border-border bg-background px-3 py-2.5">
            <p className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              <ScanLine className="h-3.5 w-3.5" aria-hidden /> Dados extraídos
            </p>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
              <div>
                <dt className="text-xs text-muted-foreground">Valor</dt>
                <dd className="font-semibold text-foreground">
                  {formatarValor(resultado.dados.valorCentavos)}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Data</dt>
                <dd className="font-medium text-foreground">{dataPtBr(resultado.dados.dataISO)}</dd>
              </div>
              {resultado.dados.pagadorNome && (
                <div>
                  <dt className="text-xs text-muted-foreground">Pagador</dt>
                  <dd className="truncate font-medium text-foreground">{resultado.dados.pagadorNome}</dd>
                </div>
              )}
              {resultado.dados.banco && (
                <div>
                  <dt className="text-xs text-muted-foreground">Banco</dt>
                  <dd className="truncate font-medium text-foreground">{resultado.dados.banco}</dd>
                </div>
              )}
            </dl>
          </div>

          {/* Parcela sugerida + alternativas */}
          {candidatas.length > 0 ? (
            <fieldset className="space-y-2">
              <legend className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                Dar baixa em qual parcela?
              </legend>
              {candidatas.map(({ parcela, sugerida }) => (
                <label
                  key={parcela.id}
                  className={cn(
                    'flex cursor-pointer items-center gap-3 rounded-lg border px-3 py-2 transition-colors',
                    parcelaId === parcela.id
                      ? 'border-ring bg-muted/50'
                      : 'border-border bg-background hover:border-ring',
                  )}
                >
                  <input
                    type="radio"
                    name="parcela-comprovante"
                    checked={parcelaId === parcela.id}
                    onChange={() => setParcelaId(parcela.id)}
                    className="h-4 w-4 accent-current"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-foreground">
                      {parcela.descricao}
                    </span>
                    <span className="block text-xs text-muted-foreground">
                      {formatarValor(parcela.valor_centavos)} · vence {dataPtBr(parcela.vencimento)}
                    </span>
                  </span>
                  {sugerida && (
                    <span className="shrink-0 rounded-full bg-success/15 px-2 py-0.5 text-[11px] font-semibold text-success">
                      Sugerida
                    </span>
                  )}
                </label>
              ))}
            </fieldset>
          ) : (
            <p className="text-sm text-muted-foreground">
              Nenhuma parcela em aberto casa com este comprovante.
            </p>
          )}

          {/* Meio de pagamento da baixa */}
          {candidatas.length > 0 && (
            <div className="flex items-center gap-2">
              <label htmlFor="meio-comprovante" className="shrink-0 text-xs font-medium text-muted-foreground">
                Meio de pagamento
              </label>
              <Select
                id="meio-comprovante"
                value={meio}
                onChange={(e) => setMeio(e.target.value)}
                options={MEIOS}
                className="h-9"
              />
            </div>
          )}
        </div>
      ) : null}
    </Dialog>
  )
}
