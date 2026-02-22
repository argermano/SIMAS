'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { useToast } from '@/components/ui/toast'
import { Download } from 'lucide-react'

interface BotaoExportarProps {
  pecaId: string
  disabled?: boolean
}

export function BotaoExportar({ pecaId, disabled }: BotaoExportarProps) {
  const [exportando, setExportando] = useState(false)
  const { success, error: toastError } = useToast()

  async function exportar() {
    setExportando(true)
    try {
      const res = await fetch('/api/exportar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pecaId, formato: 'docx' }),
      })

      if (!res.ok) {
        const data = await res.json()
        toastError('Erro', data.error ?? 'Falha ao exportar')
        return
      }

      // Download direto do blob
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `peca_${pecaId.substring(0, 8)}.docx`
      a.click()
      URL.revokeObjectURL(url)

      success('Exportado!', 'O arquivo DOCX foi baixado.')
    } catch {
      toastError('Erro', 'Falha de rede ao exportar')
    } finally {
      setExportando(false)
    }
  }

  return (
    <Button
      variant="secondary"
      size="sm"
      onClick={exportar}
      loading={exportando}
      disabled={disabled || exportando}
      className="gap-1.5"
    >
      <Download className="h-4 w-4" />
      Baixar DOCX
    </Button>
  )
}
