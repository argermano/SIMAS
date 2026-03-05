'use client'

import { useState } from 'react'
import { Paperclip, ExternalLink, Loader2 } from 'lucide-react'

interface DocumentoLinkProps {
  docId: string
  fileName: string
  dataRelativa: string
}

export function DocumentoLink({ docId, fileName, dataRelativa }: DocumentoLinkProps) {
  const [loading, setLoading] = useState(false)

  async function handleClick() {
    setLoading(true)
    try {
      const res = await fetch(`/api/documentos/${docId}/url`)
      const data = await res.json()
      if (data.url) {
        window.open(data.url, '_blank')
      }
    } catch {
      // silencioso
    } finally {
      setLoading(false)
    }
  }

  return (
    <button
      onClick={handleClick}
      disabled={loading}
      className="flex w-full items-center gap-3 rounded-lg border border-border bg-card px-3 py-2.5 text-sm text-left hover:bg-muted/50 hover:border-primary/30 transition-colors group"
    >
      <Paperclip className="h-4 w-4 shrink-0 text-amber-500" />
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium text-foreground group-hover:text-primary transition-colors">{fileName}</p>
        <p className="text-xs text-muted-foreground">{dataRelativa}</p>
      </div>
      {loading ? (
        <Loader2 className="h-4 w-4 shrink-0 animate-spin text-muted-foreground" />
      ) : (
        <ExternalLink className="h-4 w-4 shrink-0 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
      )}
    </button>
  )
}
