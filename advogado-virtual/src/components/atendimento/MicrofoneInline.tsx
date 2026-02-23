'use client'

import { useState, useRef, useCallback } from 'react'
import { Mic, Square, Loader2 } from 'lucide-react'

interface MicrofoneInlineProps {
  onTranscricao: (texto: string) => void
  disabled?: boolean
}

/**
 * Botão de microfone compacto para transcrição rápida (sem salvar no banco).
 * Destinado ao campo "Questão específica" — não exige atendimentoId nem consentimento.
 */
export function MicrofoneInline({ onTranscricao, disabled }: MicrofoneInlineProps) {
  const [estado, setEstado] = useState<'idle' | 'gravando' | 'transcrevendo'>('idle')
  const [erro, setErro]     = useState('')

  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef        = useRef<Blob[]>([])

  const iniciar = useCallback(async () => {
    setErro('')
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : 'audio/webm'

      const recorder = new MediaRecorder(stream, { mimeType })
      chunksRef.current = []

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data)
      }

      recorder.start(1000)
      mediaRecorderRef.current = recorder
      setEstado('gravando')
    } catch {
      setErro('Sem acesso ao microfone')
    }
  }, [])

  const parar = useCallback(async () => {
    if (!mediaRecorderRef.current) return
    setEstado('transcrevendo')

    const recorder = mediaRecorderRef.current
    const mimeType = recorder.mimeType

    const blob = await new Promise<Blob>((resolve) => {
      recorder.onstop = () => resolve(new Blob(chunksRef.current, { type: mimeType }))
      recorder.stop()
    })
    recorder.stream.getTracks().forEach(t => t.stop())
    mediaRecorderRef.current = null

    try {
      const formData = new FormData()
      formData.append('audio', blob, 'pedido.webm')

      const res  = await fetch('/api/ia/transcrever-audio', { method: 'POST', body: formData })
      const data = await res.json()

      if (res.ok && data.transcricao) {
        onTranscricao(data.transcricao)
      } else {
        setErro('Não foi possível transcrever')
      }
    } catch {
      setErro('Erro de rede')
    } finally {
      setEstado('idle')
    }
  }, [onTranscricao])

  return (
    <div className="flex items-center gap-1">
      {estado === 'idle' && (
        <button
          type="button"
          onClick={iniciar}
          disabled={disabled}
          title="Gravar questão por voz"
          className="flex h-8 w-8 items-center justify-center rounded-full border border-gray-200 bg-white text-gray-400 transition-colors hover:border-primary-300 hover:text-primary-700 disabled:cursor-not-allowed disabled:opacity-40"
        >
          <Mic className="h-4 w-4" />
        </button>
      )}

      {estado === 'gravando' && (
        <button
          type="button"
          onClick={parar}
          title="Parar e transcrever"
          className="flex h-8 w-8 items-center justify-center rounded-full bg-red-500 text-white transition-colors hover:bg-red-600"
        >
          <Square className="h-3.5 w-3.5" />
        </button>
      )}

      {estado === 'transcrevendo' && (
        <span className="flex h-8 w-8 items-center justify-center">
          <Loader2 className="h-4 w-4 animate-spin text-gray-400" />
        </span>
      )}

      {estado === 'gravando' && (
        <span className="flex items-center gap-1 text-xs text-red-600">
          <span className="h-2 w-2 animate-pulse rounded-full bg-red-500" />
          gravando...
        </span>
      )}

      {erro && <span className="text-xs text-red-500">{erro}</span>}
    </div>
  )
}
