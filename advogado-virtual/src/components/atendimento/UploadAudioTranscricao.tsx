'use client'

import { useState, useRef, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { Upload, Loader2, FileAudio, X } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'

const MAX_AUDIO_SIZE  = 500 * 1024 * 1024 // 500 MB
const GROQ_LIMIT      = 25 * 1024 * 1024  // 25 MB
const CHUNK_DURATION_S = 240               // 4 minutos por chunk WAV (~19MB a 16kHz mono 16-bit)
const ACCEPT_AUDIO = 'audio/*,.mp3,.wav,.m4a,.webm,.mp4,.ogg,.mpeg,.mpga'

interface UploadAudioTranscricaoProps {
  onTranscricao: (transcricao: string) => void
  atendimentoId: string | null
  disabled?: boolean
}

type Estado = 'idle' | 'processando' | 'enviando' | 'transcrevendo' | 'concluido' | 'erro'

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

// ─── WAV encoding helpers ────────────────────────────────────────────────────

function writeString(view: DataView, offset: number, str: string) {
  for (let i = 0; i < str.length; i++) {
    view.setUint8(offset + i, str.charCodeAt(i))
  }
}

function encodeWav(samples: Float32Array, sampleRate: number): Blob {
  const bytesPerSample = 2
  const dataLength = samples.length * bytesPerSample
  const buffer = new ArrayBuffer(44 + dataLength)
  const view = new DataView(buffer)

  writeString(view, 0, 'RIFF')
  view.setUint32(4, 36 + dataLength, true)
  writeString(view, 8, 'WAVE')
  writeString(view, 12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)      // PCM
  view.setUint16(22, 1, true)      // mono
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * bytesPerSample, true)
  view.setUint16(32, bytesPerSample, true)
  view.setUint16(34, 16, true)     // bits per sample
  writeString(view, 36, 'data')
  view.setUint32(40, dataLength, true)

  let offset = 44
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]))
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7FFF, true)
    offset += 2
  }

  return new Blob([buffer], { type: 'audio/wav' })
}

async function decodeAudioFile(file: File): Promise<AudioBuffer> {
  const arrayBuffer = await file.arrayBuffer()
  const ctx = new AudioContext({ sampleRate: 16000 })
  try {
    return await ctx.decodeAudioData(arrayBuffer)
  } finally {
    await ctx.close()
  }
}

function splitIntoWavChunks(audioBuffer: AudioBuffer): Blob[] {
  const sampleRate = audioBuffer.sampleRate
  const samples = audioBuffer.getChannelData(0) // mono (canal 0)
  const samplesPerChunk = CHUNK_DURATION_S * sampleRate
  const totalChunks = Math.ceil(samples.length / samplesPerChunk)
  const chunks: Blob[] = []

  for (let i = 0; i < totalChunks; i++) {
    const start = i * samplesPerChunk
    const end = Math.min(start + samplesPerChunk, samples.length)
    const segment = samples.slice(start, end)
    chunks.push(encodeWav(segment, sampleRate))
  }

  return chunks
}

// ─── Component ───────────────────────────────────────────────────────────────

export function UploadAudioTranscricao({
  onTranscricao,
  atendimentoId,
  disabled,
}: UploadAudioTranscricaoProps) {
  const [estado, setEstado]       = useState<Estado>('idle')
  const [erro, setErro]           = useState('')
  const [arquivo, setArquivo]     = useState<File | null>(null)
  const [progresso, setProgresso] = useState('')
  const inputRef  = useRef<HTMLInputElement>(null)
  const [dragAtivo, setDragAtivo] = useState(false)

  const desabilitado = disabled || !atendimentoId

  // Upload de um blob para Supabase Storage via signed URL
  async function uploadBlob(blob: Blob, fileName: string): Promise<string> {
    const res = await fetch('/api/ia/transcrever-audio-upload', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fileName, fileSize: blob.size, atendimentoId }),
    })
    if (!res.ok) {
      const data = await res.json()
      throw new Error(data.error || 'Erro ao iniciar upload')
    }
    const { uploadToken, storagePath } = await res.json()

    const supabase = createClient()
    const { error: uploadError } = await supabase.storage
      .from('documentos')
      .uploadToSignedUrl(storagePath, uploadToken, blob, {
        contentType: blob.type || 'audio/wav',
      })

    if (uploadError) throw new Error(`Upload falhou: ${uploadError.message}`)
    return storagePath
  }

  // Transcrever um arquivo já no Storage
  async function transcrever(storagePath: string, transcricaoAcumulada?: string, timeOffset?: number): Promise<string> {
    const res = await fetch('/api/ia/transcrever-audio-upload', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ storagePath, atendimentoId, transcricaoAcumulada, timeOffset }),
    })
    if (!res.ok) {
      const data = await res.json()
      throw new Error(data.error || 'Erro na transcrição')
    }
    const { transcricao } = await res.json()
    return transcricao
  }

  const processarArquivo = useCallback(async (file: File) => {
    if (!atendimentoId) return

    if (file.size > MAX_AUDIO_SIZE) {
      setErro(`Arquivo excede o limite de 500 MB (${formatFileSize(file.size)})`)
      return
    }

    setArquivo(file)
    setErro('')

    try {
      if (file.size <= GROQ_LIMIT) {
        // ── Arquivo pequeno: envio direto ──
        setEstado('enviando')
        setProgresso('Enviando áudio...')
        const storagePath = await uploadBlob(file, file.name)

        setEstado('transcrevendo')
        setProgresso('Transcrevendo áudio com IA...')
        const transcricao = await transcrever(storagePath)

        setEstado('concluido')
        setProgresso('')
        onTranscricao(transcricao)
      } else {
        // ── Arquivo grande: chunking no browser ──
        setEstado('processando')
        setProgresso('Decodificando áudio...')

        const audioBuffer = await decodeAudioFile(file)
        const chunks = splitIntoWavChunks(audioBuffer)

        let transcricaoAcumulada = ''

        for (let i = 0; i < chunks.length; i++) {
          const label = `Parte ${i + 1} de ${chunks.length}`

          setEstado('enviando')
          setProgresso(`${label} — enviando...`)
          const storagePath = await uploadBlob(chunks[i], `chunk_${i}.wav`)

          setEstado('transcrevendo')
          setProgresso(`${label} — transcrevendo...`)

          // No último chunk, envia a transcrição acumulada para salvar tudo junto
          const isLast = i === chunks.length - 1
          const timeOffset = i * CHUNK_DURATION_S
          const transcricao = await transcrever(
            storagePath,
            isLast ? transcricaoAcumulada : undefined,
            timeOffset
          )

          if (isLast) {
            // O server já concatenou e salvou
            transcricaoAcumulada = transcricao
          } else {
            // Acumula localmente
            transcricaoAcumulada += (transcricaoAcumulada ? '\n' : '') + transcricao
          }
        }

        setEstado('concluido')
        setProgresso('')
        onTranscricao(transcricaoAcumulada)
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Erro desconhecido'
      setErro(message)
      setEstado('erro')
      setProgresso('')
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
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

  const processando = estado === 'processando' || estado === 'enviando' || estado === 'transcrevendo'

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
