'use client'

import { useState, useCallback } from 'react'
import { Check, ClipboardCopy, Download } from 'lucide-react'

export function TranscricaoActions({ texto }: { texto: string }) {
  const [copiado, setCopiado] = useState(false)

  const copiar = useCallback(async () => {
    await navigator.clipboard.writeText(texto)
    setCopiado(true)
    setTimeout(() => setCopiado(false), 2000)
  }, [texto])

  const exportar = useCallback(() => {
    const blob = new Blob([texto], { type: 'text/plain;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `transcricao_${new Date().toISOString().slice(0, 10)}.txt`
    a.click()
    URL.revokeObjectURL(url)
  }, [texto])

  return (
    <div className="flex items-center gap-1">
      <button
        onClick={copiar}
        className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
        title="Copiar transcrição"
      >
        {copiado ? <Check className="h-3.5 w-3.5 text-green-600" /> : <ClipboardCopy className="h-3.5 w-3.5" />}
      </button>
      <button
        onClick={exportar}
        className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
        title="Exportar como .txt"
      >
        <Download className="h-3.5 w-3.5" />
      </button>
    </div>
  )
}
