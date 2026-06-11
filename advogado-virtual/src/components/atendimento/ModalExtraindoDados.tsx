'use client'

import { Loader2 } from 'lucide-react'

export function ModalExtraindoDados() {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="rounded-2xl bg-card shadow-2xl px-8 py-6 text-center space-y-3">
        <Loader2 className="h-8 w-8 animate-spin text-primary mx-auto" />
        <p className="text-sm font-medium text-foreground">Extraindo dados dos documentos...</p>
        <p className="text-xs text-muted-foreground">Analisando documentos com IA para preencher qualificação</p>
      </div>
    </div>
  )
}
