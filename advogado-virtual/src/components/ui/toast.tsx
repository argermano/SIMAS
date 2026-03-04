'use client'

import * as React from 'react'
import { cn } from '@/lib/utils'
import { CheckCircle, XCircle, AlertTriangle, Info, X } from 'lucide-react'

export type ToastType = 'success' | 'error' | 'warning' | 'info'

export interface ToastData {
  id: string
  type: ToastType
  title: string
  message?: string
}

interface ToastProps extends ToastData {
  onClose: (id: string) => void
}

const ICONS: Record<ToastType, React.ReactNode> = {
  success: <CheckCircle className="h-5 w-5 text-success" />,
  error:   <XCircle    className="h-5 w-5 text-destructive" />,
  warning: <AlertTriangle className="h-5 w-5 text-warning" />,
  info:    <Info       className="h-5 w-5 text-info" />,
}

const STYLES: Record<ToastType, string> = {
  success: 'border-success/20 bg-success/5',
  error:   'border-destructive/20 bg-destructive/5',
  warning: 'border-warning/20 bg-warning/5',
  info:    'border-info/20 bg-info/5',
}

export function Toast({ id, type, title, message, onClose }: ToastProps) {
  React.useEffect(() => {
    const timer = setTimeout(() => onClose(id), 5000)
    return () => clearTimeout(timer)
  }, [id, onClose])

  return (
    <div
      className={cn(
        'flex items-start gap-3 rounded-lg border p-4 shadow-md',
        'animate-in slide-in-from-right-full',
        'w-full max-w-sm',
        STYLES[type]
      )}
      role="alert"
    >
      <div className="mt-0.5 shrink-0">{ICONS[type]}</div>
      <div className="flex-1 min-w-0">
        <p className="text-base font-semibold text-foreground">{title}</p>
        {message && <p className="mt-0.5 text-sm text-muted-foreground">{message}</p>}
      </div>
      <button
        onClick={() => onClose(id)}
        className="shrink-0 rounded p-0.5 text-muted-foreground hover:text-foreground transition-colors"
        aria-label="Fechar"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────
// Context + Provider
// ─────────────────────────────────────────────────────────────

interface ToastContextValue {
  toast: (data: Omit<ToastData, 'id'>) => void
  success: (title: string, message?: string) => void
  error:   (title: string, message?: string) => void
  warning: (title: string, message?: string) => void
  info:    (title: string, message?: string) => void
}

const ToastContext = React.createContext<ToastContextValue | null>(null)

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = React.useState<ToastData[]>([])

  const addToast = React.useCallback((data: Omit<ToastData, 'id'>) => {
    const id = Math.random().toString(36).slice(2)
    setToasts(prev => [...prev, { ...data, id }])
  }, [])

  const removeToast = React.useCallback((id: string) => {
    setToasts(prev => prev.filter(t => t.id !== id))
  }, [])

  const value: ToastContextValue = React.useMemo(() => ({
    toast:   addToast,
    success: (title, message) => addToast({ type: 'success', title, message }),
    error:   (title, message) => addToast({ type: 'error',   title, message }),
    warning: (title, message) => addToast({ type: 'warning', title, message }),
    info:    (title, message) => addToast({ type: 'info',    title, message }),
  }), [addToast])

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="fixed bottom-5 right-5 z-50 flex flex-col gap-2 pointer-events-none">
        {toasts.map(t => (
          <div key={t.id} className="pointer-events-auto">
            <Toast {...t} onClose={removeToast} />
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}

export function useToast() {
  const ctx = React.useContext(ToastContext)
  if (!ctx) throw new Error('useToast deve ser usado dentro de ToastProvider')
  return ctx
}
