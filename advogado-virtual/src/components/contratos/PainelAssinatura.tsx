'use client'

import { useState, useEffect, useCallback } from 'react'
import { ConfirmDialog } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { useToast } from '@/components/ui/toast'
import { Badge } from '@/components/ui/badge'
import {
  FileSignature, CheckCircle2, Clock, XCircle, Download,
  RefreshCw, RotateCcw, Copy, Loader2,
} from 'lucide-react'
import { formatarDataHora } from '@/lib/utils'

interface Signer {
  id:           string
  name:         string
  email:        string
  act:          string
  signed:       boolean
  signed_at:    string | null
  signing_link: string | null
  d4sign_key:   string | null
}

interface Signature {
  id:              string
  status:          string
  sent_at:         string | null
  completed_at:    string | null
  cancelled_at:    string | null
  cancel_reason:   string | null
  signed_file_url: string | null
  contract_signature_signers: Signer[]
}

interface PainelAssinaturaProps {
  contratoId: string
  initial:    Signature
}

const STATUS_CONFIG: Record<string, { label: string; color: string; icon: React.ReactNode }> = {
  draft:               { label: 'Rascunho',          color: 'bg-muted text-muted-foreground',    icon: <Clock className="h-3.5 w-3.5" /> },
  uploaded:            { label: 'Enviado',            color: 'bg-blue-100 text-blue-700',    icon: <Clock className="h-3.5 w-3.5" /> },
  signers_registered:  { label: 'Signatários ok',     color: 'bg-blue-100 text-blue-700',    icon: <Clock className="h-3.5 w-3.5" /> },
  waiting_signatures:  { label: 'Aguardando',         color: 'bg-warning/10 text-warning',  icon: <Clock className="h-3.5 w-3.5" /> },
  completed:           { label: 'Concluída',          color: 'bg-success/10 text-success',  icon: <CheckCircle2 className="h-3.5 w-3.5" /> },
  download_ready:      { label: 'Assinado',           color: 'bg-success/10 text-success',  icon: <CheckCircle2 className="h-3.5 w-3.5" /> },
  cancelled:           { label: 'Cancelada',          color: 'bg-destructive/10 text-destructive',      icon: <XCircle className="h-3.5 w-3.5" /> },
}

const ACT_LABEL: Record<string, string> = { '1': 'Assinar', '2': 'Aprovar', '5': 'Testemunha' }

export function PainelAssinatura({ contratoId, initial }: PainelAssinaturaProps) {
  const { success, error: toastError } = useToast()

  const [sig,          setSig]          = useState<Signature>(initial)
  const [confirmCancel, setConfirmCancel] = useState(false)
  const [cancelReason, setCancelReason] = useState('')
  const [cancelling,   setCancelling]   = useState(false)
  const [refreshing,   setRefreshing]   = useState(false)
  const [reenvios,     setReenvios]     = useState<Record<string, boolean>>({})

  const statusCfg = STATUS_CONFIG[sig.status] ?? STATUS_CONFIG.draft
  const isActive  = ['waiting_signatures', 'uploaded', 'signers_registered'].includes(sig.status)
  const isDone    = ['completed', 'download_ready'].includes(sig.status)

  // Polling a cada 30s quando aguardando assinaturas
  const refreshStatus = useCallback(async () => {
    try {
      const res = await fetch(`/api/contratos/${contratoId}/assinatura`, { cache: 'no-store' })
      if (res.ok) {
        const data = await res.json()
        if (data.signature) setSig(data.signature)
      }
    } catch { /* silencioso */ }
  }, [contratoId])

  useEffect(() => {
    if (!isActive) return
    const id = setInterval(refreshStatus, 30_000)
    return () => clearInterval(id)
  }, [isActive, refreshStatus])

  async function handleRefresh() {
    setRefreshing(true)
    try {
      await fetch(`/api/contratos/${contratoId}/assinatura`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
      })
      await refreshStatus()
      success('Status atualizado', '')
    } catch {
      toastError('Erro', 'Não foi possível atualizar o status')
    } finally {
      setRefreshing(false)
    }
  }

  async function handleCancel() {
    setCancelling(true)
    try {
      const res = await fetch(`/api/contratos/${contratoId}/assinatura`, {
        method:  'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ reason: cancelReason }),
      })
      if (res.ok) {
        setSig(prev => ({ ...prev, status: 'cancelled', cancelled_at: new Date().toISOString(), cancel_reason: cancelReason }))
        success('Assinatura cancelada', '')
      } else {
        const d = await res.json()
        toastError('Erro', d.error ?? 'Não foi possível cancelar')
      }
    } catch {
      toastError('Erro', 'Falha de rede')
    } finally {
      setCancelling(false)
      setConfirmCancel(false)
      setCancelReason('')
    }
  }

  async function handleReenviar(signerId: string) {
    setReenvios(prev => ({ ...prev, [signerId]: true }))
    try {
      const res = await fetch(`/api/contratos/${contratoId}/assinatura/reenviar`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ signer_id: signerId }),
      })
      if (res.ok) {
        success('Notificação reenviada!', '')
      } else {
        const d = await res.json()
        toastError('Erro', d.error ?? 'Não foi possível reenviar')
      }
    } catch {
      toastError('Erro', 'Falha de rede')
    } finally {
      setReenvios(prev => ({ ...prev, [signerId]: false }))
    }
  }

  function copyLink(link: string) {
    navigator.clipboard.writeText(link).then(() => success('Link copiado!', '')).catch(() => {})
  }

  return (
    <>
      <ConfirmDialog
        open={confirmCancel}
        onClose={() => { setConfirmCancel(false); setCancelReason('') }}
        onConfirm={handleCancel}
        title="Cancelar assinatura"
        description={
          <div className="space-y-3">
            <p>Esta ação cancela o processo de assinatura na D4Sign. Os signatários não poderão mais assinar via link enviado.</p>
            <textarea
              value={cancelReason}
              onChange={e => setCancelReason(e.target.value)}
              placeholder="Motivo do cancelamento (opcional)"
              rows={2}
              className="w-full rounded-md border border-border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-400 resize-none"
            />
          </div>
        }
        confirmLabel="Cancelar assinatura"
        variant="danger"
        loading={cancelling}
      />

      <div className="rounded-xl border border-border bg-card shadow-sm overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-muted/50">
          <div className="flex items-center gap-2">
            <FileSignature className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm font-semibold text-foreground">Assinatura Digital</span>
          </div>
          <div className="flex items-center gap-2">
            <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold ${statusCfg.color}`}>
              {statusCfg.icon}
              {statusCfg.label}
            </span>
            {isActive && (
              <button
                onClick={handleRefresh}
                disabled={refreshing}
                title="Atualizar status"
                className="rounded-md p-1 text-muted-foreground hover:text-muted-foreground hover:bg-muted transition-colors"
              >
                {refreshing
                  ? <Loader2 className="h-4 w-4 animate-spin" />
                  : <RefreshCw className="h-4 w-4" />
                }
              </button>
            )}
          </div>
        </div>

        {/* Corpo */}
        <div className="px-4 py-3 space-y-3">
          {sig.sent_at && (
            <p className="text-xs text-muted-foreground">
              Enviado em {formatarDataHora(sig.sent_at)}
              {sig.completed_at && ` · Concluído em ${formatarDataHora(sig.completed_at)}`}
              {sig.cancelled_at && ` · Cancelado em ${formatarDataHora(sig.cancelled_at)}`}
            </p>
          )}

          {/* Lista de signatários */}
          <div className="space-y-2">
            {sig.contract_signature_signers.map(signer => (
              <div key={signer.id} className="flex items-start gap-3 rounded-lg bg-muted/50 px-3 py-2.5">
                {signer.signed
                  ? <CheckCircle2 className="h-4 w-4 text-success mt-0.5 shrink-0" />
                  : <Clock className="h-4 w-4 text-amber-400 mt-0.5 shrink-0" />
                }
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-medium text-foreground">{signer.name}</span>
                    <span className="text-xs text-muted-foreground">{signer.email}</span>
                    <Badge variant="secondary" className="text-xs px-1.5 py-0">{ACT_LABEL[signer.act] ?? 'Assinar'}</Badge>
                  </div>
                  {signer.signed && signer.signed_at && (
                    <p className="text-xs text-success mt-0.5">Assinou em {formatarDataHora(signer.signed_at)}</p>
                  )}
                  {!signer.signed && isActive && (
                    <div className="mt-1.5 flex items-center gap-2">
                      {signer.signing_link && (
                        <button
                          onClick={() => copyLink(signer.signing_link!)}
                          className="flex items-center gap-1 text-xs text-primary hover:text-primary font-medium"
                        >
                          <Copy className="h-3 w-3" /> Copiar link
                        </button>
                      )}
                      {signer.d4sign_key && (
                        <button
                          onClick={() => handleReenviar(signer.id)}
                          disabled={reenvios[signer.id]}
                          className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground font-medium disabled:opacity-50"
                        >
                          {reenvios[signer.id]
                            ? <Loader2 className="h-3 w-3 animate-spin" />
                            : <RotateCcw className="h-3 w-3" />
                          }
                          Reenviar
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>

          {sig.cancel_reason && (
            <p className="text-xs text-destructive italic">Motivo: {sig.cancel_reason}</p>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-4 py-3 border-t border-border">
          <div>
            {isActive && (
              <Button
                size="sm"
                variant="secondary"
                onClick={() => setConfirmCancel(true)}
                className="text-destructive hover:text-destructive hover:bg-destructive/5 border-destructive/20"
              >
                <XCircle className="h-4 w-4" />
                Cancelar assinatura
              </Button>
            )}
          </div>
          <div>
            {isDone && sig.signed_file_url && (
              <Button size="sm" asChild>
                <a href={sig.signed_file_url} target="_blank" rel="noopener noreferrer" className="gap-1.5">
                  <Download className="h-4 w-4" />
                  Baixar documento assinado
                </a>
              </Button>
            )}
          </div>
        </div>
      </div>
    </>
  )
}
