'use client'

import { useState, useRef, useCallback, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Mic, Square, Pause, Play, Loader2 } from 'lucide-react'

interface GravadorAudioProps {
  onTranscricao: (transcricao: string) => void
  atendimentoId: string | null
  disabled?: boolean
}

export function GravadorAudio({ onTranscricao, atendimentoId, disabled }: GravadorAudioProps) {
  const [estado, setEstado]         = useState<'idle' | 'gravando' | 'pausado' | 'enviando'>('idle')
  const [tempo, setTempo]           = useState(0)
  const [erro, setErro]             = useState('')
  const mediaRecorderRef            = useRef<MediaRecorder | null>(null)
  const chunksRef                   = useRef<Blob[]>([])
  const timerRef                    = useRef<ReturnType<typeof setInterval>>(undefined)

  // Timer de gravação
  useEffect(() => {
    if (estado === 'gravando') {
      timerRef.current = setInterval(() => setTempo(t => t + 1), 1000)
    } else {
      clearInterval(timerRef.current)
    }
    return () => clearInterval(timerRef.current)
  }, [estado])

  const formatarTempo = (s: number) => {
    const min = Math.floor(s / 60).toString().padStart(2, '0')
    const sec = (s % 60).toString().padStart(2, '0')
    return `${min}:${sec}`
  }

  const iniciarGravacao = useCallback(async () => {
    setErro('')
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const mediaRecorder = new MediaRecorder(stream, {
        mimeType: MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
          ? 'audio/webm;codecs=opus'
          : 'audio/webm',
      })

      chunksRef.current = []
      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data)
      }

      mediaRecorder.start(1000) // chunk a cada segundo
      mediaRecorderRef.current = mediaRecorder
      setTempo(0)
      setEstado('gravando')
    } catch {
      setErro('Não foi possível acessar o microfone. Verifique as permissões do navegador.')
    }
  }, [])

  const pausarGravacao = useCallback(() => {
    if (mediaRecorderRef.current?.state === 'recording') {
      mediaRecorderRef.current.pause()
      setEstado('pausado')
    }
  }, [])

  const retomarGravacao = useCallback(() => {
    if (mediaRecorderRef.current?.state === 'paused') {
      mediaRecorderRef.current.resume()
      setEstado('gravando')
    }
  }, [])

  const pararGravacao = useCallback(async () => {
    if (!mediaRecorderRef.current || !atendimentoId) return

    setEstado('enviando')

    // Para a gravação e espera os chunks
    const recorder = mediaRecorderRef.current
    const blob = await new Promise<Blob>((resolve) => {
      recorder.onstop = () => {
        resolve(new Blob(chunksRef.current, { type: recorder.mimeType }))
      }
      recorder.stop()
    })

    // Para o stream de áudio
    recorder.stream.getTracks().forEach(t => t.stop())
    mediaRecorderRef.current = null

    // Envia para a API
    try {
      const formData = new FormData()
      formData.append('audio', blob, 'gravacao.webm')

      const res = await fetch(`/api/atendimentos/${atendimentoId}/audio`, {
        method: 'POST',
        body: formData,
      })

      const data = await res.json()

      if (!res.ok) {
        setErro(data.error ?? 'Erro ao enviar áudio')
      } else {
        onTranscricao(data.transcricao ?? '')
      }
    } catch {
      setErro('Erro de rede ao enviar áudio')
    } finally {
      setEstado('idle')
    }
  }, [atendimentoId, onTranscricao])

  const desabilitado = disabled || !atendimentoId

  return (
    <div className="space-y-3">
      {/* Controles */}
      <div className="flex items-center gap-3">
        {estado === 'idle' && (
          <Button
            onClick={iniciarGravacao}
            disabled={desabilitado}
            size="lg"
            variant="default"
            className="gap-2"
          >
            <Mic className="h-5 w-5" />
            Gravar áudio
          </Button>
        )}

        {estado === 'gravando' && (
          <>
            <Button onClick={pausarGravacao} variant="secondary" size="md" className="gap-2">
              <Pause className="h-4 w-4" />
              Pausar
            </Button>
            <Button onClick={pararGravacao} variant="danger" size="md" className="gap-2">
              <Square className="h-4 w-4" />
              Parar e transcrever
            </Button>
          </>
        )}

        {estado === 'pausado' && (
          <>
            <Button onClick={retomarGravacao} variant="secondary" size="md" className="gap-2">
              <Play className="h-4 w-4" />
              Continuar
            </Button>
            <Button onClick={pararGravacao} variant="danger" size="md" className="gap-2">
              <Square className="h-4 w-4" />
              Parar e transcrever
            </Button>
          </>
        )}

        {estado === 'enviando' && (
          <div className="flex items-center gap-2 text-primary-800">
            <Loader2 className="h-5 w-5 animate-spin" />
            <span className="text-sm font-medium">Transcrevendo com IA...</span>
          </div>
        )}

        {/* Timer */}
        {(estado === 'gravando' || estado === 'pausado') && (
          <div className="flex items-center gap-2">
            {estado === 'gravando' && (
              <span className="h-3 w-3 animate-pulse rounded-full bg-red-500" />
            )}
            <span className="font-mono text-lg font-bold text-gray-700">
              {formatarTempo(tempo)}
            </span>
          </div>
        )}
      </div>

      {/* Dica */}
      {estado === 'idle' && !desabilitado && (
        <p className="text-xs text-gray-400">
          Grave o relato do cliente. O áudio será transcrito automaticamente pela IA.
        </p>
      )}

      {desabilitado && estado === 'idle' && (
        <p className="text-xs text-amber-600">
          Selecione um cliente primeiro para iniciar a gravação.
        </p>
      )}

      {/* Erro */}
      {erro && (
        <p className="text-sm text-red-600">{erro}</p>
      )}
    </div>
  )
}
