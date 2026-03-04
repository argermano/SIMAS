'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Trash2, Loader2 } from 'lucide-react'

interface BotaoExcluirAtendimentoProps {
  atendimentoId: string
}

export function BotaoExcluirAtendimento({ atendimentoId }: BotaoExcluirAtendimentoProps) {
  const router = useRouter()
  const [confirmando, setConfirmando] = useState(false)
  const [excluindo, setExcluindo] = useState(false)

  async function excluir() {
    setExcluindo(true)
    try {
      const res = await fetch(`/api/atendimentos/${atendimentoId}`, {
        method: 'DELETE',
      })
      if (res.ok) {
        router.refresh()
      }
    } catch {
      // silently fail
    } finally {
      setExcluindo(false)
      setConfirmando(false)
    }
  }

  if (confirmando) {
    return (
      <div className="flex items-center gap-1.5">
        <button
          onClick={excluir}
          disabled={excluindo}
          className="flex items-center gap-1 rounded-md bg-destructive px-2.5 py-1.5 text-xs font-medium text-white hover:bg-destructive/90 disabled:opacity-50 transition-colors"
        >
          {excluindo ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Trash2 className="h-3.5 w-3.5" />
          )}
          Confirmar
        </button>
        <button
          onClick={() => setConfirmando(false)}
          disabled={excluindo}
          className="rounded-md px-2.5 py-1.5 text-xs font-medium text-muted-foreground hover:bg-muted transition-colors"
        >
          Cancelar
        </button>
      </div>
    )
  }

  return (
    <button
      onClick={() => setConfirmando(true)}
      className="shrink-0 rounded-lg p-2 text-border hover:bg-destructive/5 hover:text-destructive transition-colors"
      title="Excluir atendimento"
    >
      <Trash2 className="h-4 w-4" />
    </button>
  )
}
