'use client'

import { useEffect, useState } from 'react'
import { Send } from 'lucide-react'
import { Dialog } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Spinner } from '@/components/ui/spinner'
import { useToast } from '@/components/ui/toast'
import type { Parcela } from './tipos'

/**
 * Comunicar cobrança por WhatsApp sob demanda (pedido do dono, 2026-07-11):
 * abre com a MENSAGEM GERADA (descrição + valor + vencimento + Pix), o humano
 * revisa/edita e clica Enviar. Complementa o cron — a parcela (mesmo avulsa)
 * continua recebendo os avisos automáticos D-3/D-0 normalmente.
 */
export function ModalComunicar({
  parcela,
  onFechar,
  onEnviado,
}: {
  parcela: Parcela | null
  onFechar: () => void
  onEnviado: () => void
}) {
  const { success, error: toastError } = useToast()
  const [carregando, setCarregando] = useState(false)
  const [enviando, setEnviando] = useState(false)
  const [texto, setTexto] = useState('')
  const [extras, setExtras] = useState<string[]>([])
  const [telefone, setTelefone] = useState<string | null>(null)
  const [avisoOptOut, setAvisoOptOut] = useState(false)
  const [vencida, setVencida] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  useEffect(() => {
    if (!parcela) return
    setCarregando(true)
    setErro(null)
    setTexto('')
    ;(async () => {
      try {
        const r = await fetch(`/api/financeiro/parcelas/${parcela.id}/comunicar`)
        const d = await r.json().catch(() => ({}))
        if (!r.ok) {
          setErro((d as { error?: string }).error ?? 'Não foi possível gerar a mensagem.')
          return
        }
        const resp = d as { texto: string; extras?: string[]; telefone: string | null; avisoOptOut: boolean; vencida: boolean }
        setTexto(resp.texto)
        setExtras(resp.extras ?? [])
        setTelefone(resp.telefone)
        setAvisoOptOut(resp.avisoOptOut)
        setVencida(resp.vencida)
      } catch {
        setErro('Falha de rede ao gerar a mensagem.')
      } finally {
        setCarregando(false)
      }
    })()
  }, [parcela])

  async function enviar() {
    if (!parcela || enviando) return
    setEnviando(true)
    try {
      const r = await fetch(`/api/financeiro/parcelas/${parcela.id}/comunicar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ texto }),
      })
      const d = await r.json().catch(() => ({}))
      if (!r.ok) {
        toastError('Não enviado', (d as { error?: string }).error ?? 'Tente novamente.')
        return
      }
      success('Cobrança enviada!', telefone ? `Mensagem enviada para ${telefone}.` : 'Mensagem enviada.')
      onEnviado()
      onFechar()
    } catch {
      toastError('Não enviado', 'Falha de rede. Tente novamente.')
    } finally {
      setEnviando(false)
    }
  }

  return (
    <Dialog open={parcela !== null} onClose={onFechar} title="Comunicar cobrança por WhatsApp">
      {carregando ? (
        <p className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
          <Spinner className="h-4 w-4" /> Gerando a mensagem…
        </p>
      ) : erro ? (
        <p className="py-6 text-sm text-destructive">{erro}</p>
      ) : (
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Para: <span className="font-medium text-foreground">{telefone ?? 'cliente sem telefone cadastrado'}</span>
          </p>
          {avisoOptOut && (
            <p className="rounded-md bg-warning/10 px-3 py-2 text-xs text-warning">
              Este cliente está com os avisos automáticos desligados — este envio manual é uma decisão sua.
            </p>
          )}
          {vencida && (
            <p className="rounded-md bg-warning/10 px-3 py-2 text-xs text-warning">
              Parcela vencida: a mensagem foi gerada com “venceu em”. Revise o tom antes de enviar.
            </p>
          )}
          <Textarea
            label="Mensagem 1 — o aviso (revise/edite antes de enviar)"
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            className="min-h-[160px] text-xs"
            disabled={enviando}
          />
          {extras.map((m, i) => (
            <div key={i}>
              <p className="mb-1 text-xs font-medium text-muted-foreground">
                Mensagem {i + 2} — enviada em seguida, separada (para o cliente copiar com um toque)
              </p>
              <pre className="max-h-24 overflow-auto rounded-md border border-border bg-muted/40 p-2 font-mono text-[11px] text-muted-foreground">{m}</pre>
            </div>
          ))}
          <div className="flex justify-end gap-2 border-t border-border/60 pt-3">
            <Button variant="secondary" onClick={onFechar} disabled={enviando}>
              Cancelar
            </Button>
            <Button onClick={enviar} loading={enviando} disabled={!telefone || texto.trim().length < 10}>
              <Send className="h-4 w-4" /> Enviar pelo WhatsApp
            </Button>
          </div>
        </div>
      )}
    </Dialog>
  )
}
