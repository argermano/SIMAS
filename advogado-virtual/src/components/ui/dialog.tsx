'use client'

import * as React from 'react'
import { createPortal } from 'react-dom'
import { cn } from '@/lib/utils'
import { X } from 'lucide-react'
import { Button } from './button'

interface DialogProps {
  open: boolean
  onClose: () => void
  title: string
  description?: string
  children?: React.ReactNode
  footer?: React.ReactNode
  size?: 'sm' | 'md' | 'lg'
}

const SIZES = {
  sm: 'max-w-sm',
  md: 'max-w-lg',
  lg: 'max-w-2xl',
}

export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  size = 'md',
}: DialogProps) {
  // ids únicos por instância: sem isso dois diálogos empilhados (ConfirmDialog
  // sobre Dialog) teriam o mesmo id de título e o leitor de tela anunciaria o
  // título de trás (aria-labelledby resolve para o primeiro id igual no DOM).
  const uid = React.useId()
  const titleId = `${uid}-title`
  const descId = `${uid}-desc`

  React.useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    if (open) document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [open, onClose])

  // Portal p/ o body: sem isso o `fixed` se ancora em qualquer ancestral com
  // filter/backdrop-filter/transform (ex.: o <header> com backdrop-blur) em vez
  // da viewport — o modal aberto de um botão do cabeçalho saía cortado no topo.
  // Só após montar (evita mismatch de SSR).
  const [montado, setMontado] = React.useState(false)
  React.useEffect(() => { setMontado(true) }, [])

  if (!open || !montado) return null

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      aria-describedby={description ? descId : undefined}
    >
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* max-h + coluna flex: modal mais alto que a tela (ex.: celular) rola o
          MIOLO em vez de cortar título/rodapé sem scroll. dvh acompanha a barra
          de URL do navegador móvel. */}
      <div
        className={cn(
          'relative flex max-h-[calc(100dvh-2rem)] w-full flex-col rounded-xl bg-card shadow-xl',
          SIZES[size]
        )}
      >
        <div className="flex shrink-0 items-start justify-between p-6 pb-4">
          <div>
            <h2 id={titleId} className="text-xl font-semibold text-foreground">
              {title}
            </h2>
            {description && (
              <p id={descId} className="mt-1 text-sm text-muted-foreground">{description}</p>
            )}
          </div>
          <button
            onClick={onClose}
            className="ml-4 rounded-md p-1 text-muted-foreground hover:text-foreground transition-colors"
            aria-label="Fechar"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {children && (
          <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-4">{children}</div>
        )}

        {footer && (
          <div className="flex shrink-0 justify-end gap-3 border-t border-border px-6 py-4">
            {footer}
          </div>
        )}
      </div>
    </div>,
    document.body,
  )
}

// ─────────────────────────────────────────────────────────────
// Dialog de confirmação
// ─────────────────────────────────────────────────────────────

interface ConfirmDialogProps {
  open: boolean
  onClose: () => void
  onConfirm: () => void
  title: string
  description: React.ReactNode
  confirmLabel?: string
  cancelLabel?: string
  variant?: 'danger' | 'default'
  loading?: boolean
}

export function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  description,
  confirmLabel = 'Confirmar',
  cancelLabel  = 'Cancelar',
  variant      = 'default',
  loading      = false,
}: ConfirmDialogProps) {
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={title}
      size="sm"
      footer={
        <>
          <Button variant="secondary" size="md" onClick={onClose} disabled={loading}>
            {cancelLabel}
          </Button>
          <Button
            variant={variant === 'danger' ? 'danger' : 'default'}
            size="md"
            onClick={onConfirm}
            loading={loading}
          >
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div className="text-base text-muted-foreground">{description}</div>
    </Dialog>
  )
}
