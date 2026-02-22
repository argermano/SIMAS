'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Trash2, Loader2 } from 'lucide-react'

interface BotaoExcluirPecaProps {
  pecaId: string
}

export function BotaoExcluirPeca({ pecaId }: BotaoExcluirPecaProps) {
  const router = useRouter()
  const [confirmando, setConfirmando] = useState(false)
  const [excluindo, setExcluindo] = useState(false)

  async function excluir(e: React.MouseEvent) {
    e.preventDefault()
    e.stopPropagation()
    setExcluindo(true)
    try {
      const res = await fetch(`/api/pecas/${pecaId}`, { method: 'DELETE' })
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

  function handleConfirm(e: React.MouseEvent) {
    e.preventDefault()
    e.stopPropagation()
    setConfirmando(true)
  }

  function handleCancel(e: React.MouseEvent) {
    e.preventDefault()
    e.stopPropagation()
    setConfirmando(false)
  }

  if (confirmando) {
    return (
      <div className="flex items-center gap-1" onClick={e => e.preventDefault()}>
        <button
          onClick={excluir}
          disabled={excluindo}
          className="flex items-center gap-1 rounded-md bg-red-600 px-2 py-1 text-xs font-medium text-white hover:bg-red-700 disabled:opacity-50 transition-colors"
        >
          {excluindo ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : (
            <Trash2 className="h-3 w-3" />
          )}
          Sim
        </button>
        <button
          onClick={handleCancel}
          disabled={excluindo}
          className="rounded-md px-2 py-1 text-xs font-medium text-gray-500 hover:bg-gray-100 transition-colors"
        >
          Não
        </button>
      </div>
    )
  }

  return (
    <button
      onClick={handleConfirm}
      className="shrink-0 rounded p-1 text-gray-300 hover:bg-red-50 hover:text-red-500 transition-colors"
      title="Excluir peça"
    >
      <Trash2 className="h-3.5 w-3.5" />
    </button>
  )
}
