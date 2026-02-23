'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { CheckCircle2, XCircle } from 'lucide-react'

interface BotoesRevisaoProps {
  pecaId: string
}

export function BotoesRevisao({ pecaId }: BotoesRevisaoProps) {
  const router = useRouter()
  const [aprovando, setAprovando]           = useState(false)
  const [rejeitando, setRejeitando]         = useState(false)
  const [modoRejeitar, setModoRejeitar]     = useState(false)
  const [motivo, setMotivo]                 = useState('')
  const [erro, setErro]                     = useState<string | null>(null)

  async function aprovar() {
    setAprovando(true)
    setErro(null)
    try {
      const res = await fetch(`/api/pecas/${pecaId}/aprovar`, { method: 'POST' })
      if (!res.ok) {
        const data = await res.json()
        setErro(data.error ?? 'Erro ao aprovar')
        return
      }
      router.refresh()
    } finally {
      setAprovando(false)
    }
  }

  async function rejeitar() {
    if (!motivo.trim()) {
      setErro('Informe o motivo da rejeição')
      return
    }
    setRejeitando(true)
    setErro(null)
    try {
      const res = await fetch(`/api/pecas/${pecaId}/rejeitar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ motivo: motivo.trim() }),
      })
      if (!res.ok) {
        const data = await res.json()
        setErro(data.error ?? 'Erro ao rejeitar')
        return
      }
      router.refresh()
    } finally {
      setRejeitando(false)
    }
  }

  if (modoRejeitar) {
    return (
      <div className="mt-3 space-y-2">
        <textarea
          className="w-full rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-gray-800 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-red-300 resize-none"
          rows={2}
          placeholder="Descreva o motivo da rejeição..."
          value={motivo}
          onChange={(e) => setMotivo(e.target.value)}
          autoFocus
        />
        {erro && <p className="text-xs text-red-600">{erro}</p>}
        <div className="flex gap-2">
          <Button
            size="sm"
            variant="ghost"
            className="text-red-700 border border-red-200 hover:bg-red-50"
            onClick={rejeitar}
            loading={rejeitando}
          >
            Confirmar rejeição
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => { setModoRejeitar(false); setMotivo(''); setErro(null) }}
            disabled={rejeitando}
          >
            Cancelar
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="flex items-center gap-2">
      {erro && <p className="text-xs text-red-600">{erro}</p>}
      <Button
        size="sm"
        onClick={aprovar}
        loading={aprovando}
        className="bg-emerald-600 hover:bg-emerald-700 text-white"
      >
        <CheckCircle2 className="h-3.5 w-3.5 mr-1" />
        Aprovar
      </Button>
      <Button
        size="sm"
        variant="ghost"
        className="text-red-600 border border-red-200 hover:bg-red-50"
        onClick={() => setModoRejeitar(true)}
        disabled={aprovando}
      >
        <XCircle className="h-3.5 w-3.5 mr-1" />
        Rejeitar
      </Button>
    </div>
  )
}
