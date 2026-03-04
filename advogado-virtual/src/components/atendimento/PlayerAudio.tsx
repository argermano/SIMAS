'use client'

import { useState } from 'react'
import { Headphones, Loader2, ChevronUp } from 'lucide-react'

interface PlayerAudioProps {
  atendimentoId: string
}

export function PlayerAudio({ atendimentoId }: PlayerAudioProps) {
  const [urls, setUrls] = useState<string[]>([])
  const [loading, setLoading] = useState(false)
  const [aberto, setAberto] = useState(false)
  const [erro, setErro] = useState('')

  async function toggle() {
    if (aberto) {
      setAberto(false)
      return
    }

    if (urls.length === 0) {
      setLoading(true)
      setErro('')
      try {
        const res = await fetch(`/api/atendimentos/${atendimentoId}/audio-url`)
        const data = await res.json()
        if (!res.ok) {
          setErro('Não foi possível carregar o áudio.')
          return
        }
        setUrls(data.urls ?? [])
      } catch {
        setErro('Erro de rede ao carregar o áudio.')
        return
      } finally {
        setLoading(false)
      }
    }

    setAberto(true)
  }

  return (
    <div className="mt-2">
      <button
        onClick={toggle}
        className="flex items-center gap-1.5 text-xs font-medium text-primary hover:text-primary transition-colors"
      >
        {loading ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : aberto ? (
          <ChevronUp className="h-3.5 w-3.5" />
        ) : (
          <Headphones className="h-3.5 w-3.5" />
        )}
        {loading ? 'Carregando áudio...' : aberto ? 'Fechar player' : 'Ouvir gravação'}
      </button>

      {aberto && (
        <div className="mt-2 space-y-2">
          {erro && <p className="text-xs text-destructive">{erro}</p>}
          {urls.length === 0 && !erro && (
            <p className="text-xs text-muted-foreground italic">Áudio não disponível.</p>
          )}
          {urls.map((url, i) => (
            <div key={i} className="flex items-center gap-2">
              {urls.length > 1 && (
                <span className="shrink-0 text-xs text-muted-foreground">Parte {i + 1}</span>
              )}
              <audio
                controls
                src={url}
                className="h-8 w-full max-w-sm rounded"
                preload="none"
              />
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
