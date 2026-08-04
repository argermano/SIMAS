'use client'

import { useState, useCallback } from 'react'
import { Check, ClipboardCopy, Download } from 'lucide-react'
import { useToast } from '@/components/ui/toast'
import { baixarBlob, mensagemErroDownload } from '@/lib/download'

export function TranscricaoActions({ texto }: { texto: string }) {
  const { error: toastError } = useToast()
  const [copiado, setCopiado] = useState(false)

  const copiar = useCallback(async () => {
    await navigator.clipboard.writeText(texto)
    setCopiado(true)
    setTimeout(() => setCopiado(false), 2000)
  }, [texto])

  // .txt da transcrição: no Chrome/Edge o seletor deixa escolher a pasta; nos
  // demais navegadores é o download clássico de sempre.
  const exportar = useCallback(async () => {
    const blob = new Blob([texto], { type: 'text/plain;charset=utf-8' })
    try {
      await baixarBlob({
        blob,
        filename: `transcricao_${new Date().toISOString().slice(0, 10)}.txt`,
      })
    } catch (e) {
      toastError('Não foi possível salvar o arquivo', mensagemErroDownload(e))
    }
  }, [texto, toastError])

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
