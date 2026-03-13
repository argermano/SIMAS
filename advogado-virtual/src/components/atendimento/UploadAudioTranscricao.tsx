'use client'

import { useState, useRef, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { Upload, Loader2, FileAudio, X } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'

const MAX_AUDIO_SIZE = 500 * 1024 * 1024 // 500 MB
const ACCEPT_AUDIO = 'audio/*,.mp3,.wav,.m4a,.webm,.mp4,.ogg,.mpeg,.mpga'

interface UploadAudioTranscricaoProps {
  onTranscricao: (transcricao: string) => void
  atendimentoId: string | null
  disabled?: boolean
}

type Estado = 'idle' | 'enviando' | 'transcrevendo' | 'concluido' | 'erro'

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export function UploadAudioTranscricao({
  onTranscricao,
  atendimentoId,
  disabled,
}: UploadAudioTranscricaoProps) {
  const [estado, setEstado]     = useState<Estado>('idle')
  const [erro, setErro]         = useState('')
  const [arquivo, setArquivo]   = useState<File | null>(null)
  const [progresso, setProgresso] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const dragRef  = useRef<HTMLDivElement>(null)
  const [dragAtivo, setDragAtivo] = useState(false)

  const desabilitado = disabled || !atendimentoId

  const processarArquivo = useCallback(async (file: File) => {
    if (!atendimentoId) return

    if (file.size > MAX_AUDIO_SIZE) {
      setErro(`Arquivo excede o limite de 500 MB (${formatFileSize(file.size)})`)
      return
    }

    setArquivo(file)
    setErro('')
    setEstado('enviando')
    setProgresso('Enviando áudio...')

    try {
      // Step 1: Get signed upload URL
      const urlRes = await fetch('/api/ia/transcrever-audio-upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fileName:      file.name,
          fileSize:      file.size,
          atendimentoId,
        }),
      })

      if (!urlRes.ok) {
        const data = await urlRes.json()
        throw new Error(data.error || 'Erro ao iniciar upload')
      }

      const { uploadUrl, uploadToken, storagePath } = await urlRes.json()

      // Step 2: Upload directly to Supabase Storage
      const supabase = createClient()
      const { error: uploadError } = await supabase.storage
        .from('documentos')
        .uploadToSignedUrl(storagePath, uploadToken, file, {
          contentType: file.type || 'audio/mpeg',
        })

      if (uploadError) {
        throw new Error(`Upload falhou: ${uploadError.message}`)
      }

      // Step 3: Trigger transcription
      setEstado('transcrevendo')
      const sizeLabel = file.size > 25 * 1024 * 1024
        ? 'Transcrevendo áudio (arquivo grande, pode levar alguns minutos)...'
        : 'Transcrevendo áudio com IA...'
      setProgresso(sizeLabel)

      const transcRes = await fetch('/api/ia/transcrever-audio-upload', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ storagePath, atendimentoId }),
      })

      if (!transcRes.ok) {
        const data = await transcRes.json()
        throw new Error(data.error || 'Erro na transcrição')
      }

      const { transcricao } = await transcRes.json()
      setEstado('concluido')
      setProgresso('')
      onTranscricao(transcricao)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Erro desconhecido'
      setErro(message)
      setEstado('erro')
      setProgresso('')
    }
  }, [atendimentoId, onTranscricao])

  const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) processarArquivo(file)
    if (inputRef.current) inputRef.current.value = ''
  }, [processarArquivo])

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setDragAtivo(false)
    const file = e.dataTransfer.files[0]
    if (file && file.type.startsWith('audio/')) {
      processarArquivo(file)
    }
  }, [processarArquivo])

  const cancelar = useCallback(() => {
    setEstado('idle')
    setArquivo(null)
    setErro('')
    setProgresso('')
  }, [])

  const processando = estado === 'enviando' || estado === 'transcrevendo'

  return (
    <div className="space-y-2">
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPT_AUDIO}
        onChange={handleFileChange}
        className="hidden"
        disabled={desabilitado || processando}
      />

      {estado === 'idle' || estado === 'erro' ? (
        <div
          ref={dragRef}
          onDragOver={(e) => { e.preventDefault(); setDragAtivo(true) }}
          onDragLeave={() => setDragAtivo(false)}
          onDrop={handleDrop}
          onClick={() => !desabilitado && inputRef.current?.click()}
          className={`flex items-center justify-center gap-3 rounded-lg border-2 border-dashed p-4 transition-colors cursor-pointer ${
            desabilitado
              ? 'border-muted bg-muted/30 cursor-not-allowed opacity-60'
              : dragAtivo
                ? 'border-primary bg-primary/5'
                : 'border-muted-foreground/25 hover:border-primary/50 hover:bg-muted/30'
          }`}
        >
          <Upload className="h-5 w-5 text-muted-foreground" />
          <div className="text-sm">
            <span className="font-medium text-foreground">Upload de arquivo de áudio</span>
            <span className="text-muted-foreground ml-1">
              — arraste ou clique (MP3, WAV, M4A, até 500 MB)
            </span>
          </div>
        </div>
      ) : (
        <div className="flex items-center gap-3 rounded-lg border bg-muted/30 p-4">
          <FileAudio className="h-5 w-5 text-muted-foreground shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-foreground truncate">
              {arquivo?.name}
            </p>
            <div className="flex items-center gap-2 mt-1">
              {processando && <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />}
              <p className="text-xs text-muted-foreground">{progresso}</p>
            </div>
          </div>
          {processando && (
            <Button
              variant="ghost"
              size="sm"
              onClick={cancelar}
              className="shrink-0"
            >
              <X className="h-4 w-4" />
            </Button>
          )}
        </div>
      )}

      {erro && (
        <p className="text-sm text-destructive">{erro}</p>
      )}
    </div>
  )
}
