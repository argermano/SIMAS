'use client'

import { useState, useRef, useCallback, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog } from '@/components/ui/dialog'
import { useToast } from '@/components/ui/toast'
import { Mic, Square, Pause, Play, Loader2, ShieldCheck } from 'lucide-react'

// Limites de gravação
const LIMITE_SEGUNDOS = 3600  // 60 minutos
const CHUNK_SEGUNDOS  = 600   // 10 minutos por chunk (limite Whisper ~25MB)

interface GravadorAudioProps {
  onTranscricao: (transcricao: string) => void
  atendimentoId: string | null
  disabled?: boolean
  /** Se false, pula o modal de consentimento LGPD (ex: relato pós-reunião só com a voz do advogado) */
  requerConsentimento?: boolean
}

export function GravadorAudio({ onTranscricao, atendimentoId, disabled, requerConsentimento = true }: GravadorAudioProps) {
  const { warning: toastWarning, error: toastError } = useToast()

  const [estado, setEstado]               = useState<'idle' | 'gravando' | 'pausado' | 'enviando'>('idle')
  const [tempo, setTempo]                 = useState(0)
  const [erro, setErro]                   = useState('')
  const [consentimentoDado, setConsentimentoDado] = useState(false)
  const [modalConsentimento, setModalConsentimento] = useState(false)
  const [checkboxMarcado, setCheckboxMarcado]     = useState(false)
  const [processandoChunk, setProcessandoChunk]   = useState(false)

  const mediaRecorderRef       = useRef<MediaRecorder | null>(null)
  const streamRef              = useRef<MediaStream | null>(null)
  const chunksRef              = useRef<Blob[]>([])
  const timerRef               = useRef<ReturnType<typeof setInterval>>(undefined)
  const chunkNumeroRef         = useRef(0)
  const transcricaoAcumuladaRef = useRef('')
  // Evita disparar processarChunk múltiplas vezes no mesmo segundo
  const chunkEmAndamentoRef    = useRef(false)

  // ─── Timer de gravação ──────────────────────────────────────────
  useEffect(() => {
    if (estado === 'gravando') {
      timerRef.current = setInterval(() => setTempo(t => t + 1), 1000)
    } else {
      clearInterval(timerRef.current)
    }
    return () => clearInterval(timerRef.current)
  }, [estado])

  // ─── Limites de tempo e chunking ────────────────────────────────
  useEffect(() => {
    if (estado !== 'gravando') return

    // Avisos
    if (tempo === LIMITE_SEGUNDOS - 300) {
      toastWarning('Aviso de gravação', '5 minutos restantes de gravação')
    }
    if (tempo === LIMITE_SEGUNDOS - 60) {
      toastWarning('Aviso de gravação', '1 minuto restante — a gravação será encerrada automaticamente')
    }

    // Auto-stop ao atingir o limite
    if (tempo >= LIMITE_SEGUNDOS) {
      pararGravacaoFinal()
      return
    }

    // Chunking automático a cada 10 minutos (exceto no segundo 0)
    if (tempo > 0 && tempo % CHUNK_SEGUNDOS === 0 && !chunkEmAndamentoRef.current) {
      chunkEmAndamentoRef.current = true
      processarChunk().finally(() => { chunkEmAndamentoRef.current = false })
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tempo, estado])

  const formatarTempo = (s: number) => {
    const h   = Math.floor(s / 3600)
    const min = Math.floor((s % 3600) / 60).toString().padStart(2, '0')
    const sec = (s % 60).toString().padStart(2, '0')
    return h > 0 ? `${h}:${min}:${sec}` : `${min}:${sec}`
  }

  // ─── Enviar um chunk para transcrição ───────────────────────────
  const enviarChunkParaAPI = useCallback(async (blob: Blob, chunkNum: number): Promise<string> => {
    if (!atendimentoId) return ''
    try {
      const formData = new FormData()
      formData.append('audio', blob, `gravacao_chunk_${chunkNum}.webm`)

      const res  = await fetch(`/api/atendimentos/${atendimentoId}/audio`, {
        method: 'POST',
        body:   formData,
      })
      const data = await res.json()
      return res.ok ? (data.transcricao ?? '') : ''
    } catch {
      return ''
    }
  }, [atendimentoId])

  // ─── Processar chunk intermediário (sem parar o stream) ─────────
  const processarChunk = useCallback(async () => {
    if (!mediaRecorderRef.current || !streamRef.current) return

    setProcessandoChunk(true)
    const recorder   = mediaRecorderRef.current
    const mimeType   = recorder.mimeType
    const chunkNum   = chunkNumeroRef.current + 1
    chunkNumeroRef.current = chunkNum

    // Para o recorder atual e captura o blob
    const blob = await new Promise<Blob>((resolve) => {
      recorder.onstop = () => {
        resolve(new Blob(chunksRef.current, { type: mimeType }))
      }
      chunksRef.current = []
      recorder.stop()
    })

    // Inicia novo recorder no mesmo stream (sem pedir permissão novamente)
    const novoRecorder = new MediaRecorder(streamRef.current, { mimeType })
    chunksRef.current  = []
    novoRecorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunksRef.current.push(e.data)
    }
    novoRecorder.start(1000)
    mediaRecorderRef.current = novoRecorder

    // Transcreve em background sem bloquear UI
    enviarChunkParaAPI(blob, chunkNum).then(transcricao => {
      if (transcricao) {
        const sep = transcricaoAcumuladaRef.current ? '\n' : ''
        transcricaoAcumuladaRef.current += sep + transcricao
      }
    }).finally(() => setProcessandoChunk(false))
  }, [enviarChunkParaAPI])

  // ─── Parar gravação e consolidar transcrição ────────────────────
  const pararGravacaoFinal = useCallback(async () => {
    if (!mediaRecorderRef.current || !atendimentoId) return

    setEstado('enviando')
    const recorder = mediaRecorderRef.current
    const mimeType = recorder.mimeType

    const blob = await new Promise<Blob>((resolve) => {
      recorder.onstop = () => {
        resolve(new Blob(chunksRef.current, { type: mimeType }))
      }
      recorder.stop()
    })

    // Para o stream de áudio
    streamRef.current?.getTracks().forEach(t => t.stop())
    streamRef.current = null
    mediaRecorderRef.current = null

    try {
      const chunkNum = chunkNumeroRef.current + 1
      const formData = new FormData()
      formData.append('audio', blob, `gravacao_chunk_${chunkNum}.webm`)

      const res  = await fetch(`/api/atendimentos/${atendimentoId}/audio`, {
        method: 'POST',
        body:   formData,
      })
      const data = await res.json()

      if (!res.ok) {
        setErro(data.error ?? 'Erro ao enviar áudio')
      } else {
        const transcricaoFinal = transcricaoAcumuladaRef.current
          ? transcricaoAcumuladaRef.current + '\n' + (data.transcricao ?? '')
          : (data.transcricao ?? '')

        // Reset acumulador
        transcricaoAcumuladaRef.current = ''
        chunkNumeroRef.current = 0

        onTranscricao(transcricaoFinal)
      }
    } catch {
      setErro('Erro de rede ao enviar áudio')
    } finally {
      setEstado('idle')
      setTempo(0)
    }
  }, [atendimentoId, onTranscricao])

  // ─── Iniciar gravação ────────────────────────────────────────────
  const iniciarGravacaoReal = useCallback(async () => {
    setErro('')
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      streamRef.current = stream

      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : 'audio/webm'

      const mediaRecorder = new MediaRecorder(stream, { mimeType })
      chunksRef.current = []
      chunkNumeroRef.current = 0
      transcricaoAcumuladaRef.current = ''

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data)
      }

      mediaRecorder.start(1000)
      mediaRecorderRef.current = mediaRecorder
      setTempo(0)
      setEstado('gravando')

      // Salva consentimento no banco se tiver atendimentoId
      if (atendimentoId) {
        fetch(`/api/atendimentos/${atendimentoId}`, {
          method:  'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({
            consentimento_gravacao:       true,
            consentimento_confirmado_em:  new Date().toISOString(),
          }),
        }).catch(() => { /* silencioso */ })
      }
    } catch {
      setErro('Não foi possível acessar o microfone. Verifique as permissões do navegador.')
    }
  }, [atendimentoId])

  const handleClicarGravar = useCallback(() => {
    if (!requerConsentimento || consentimentoDado) {
      iniciarGravacaoReal()
    } else {
      setCheckboxMarcado(false)
      setModalConsentimento(true)
    }
  }, [requerConsentimento, consentimentoDado, iniciarGravacaoReal])

  const handleConfirmarConsentimento = useCallback(() => {
    setConsentimentoDado(true)
    setModalConsentimento(false)
    iniciarGravacaoReal()
  }, [iniciarGravacaoReal])

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

  const desabilitado = disabled || !atendimentoId

  return (
    <>
      {/* Modal de consentimento LGPD */}
      <Dialog
        open={modalConsentimento}
        onClose={() => setModalConsentimento(false)}
        title="Autorização de Gravação"
        size="sm"
        footer={
          <>
            <Button
              variant="secondary"
              size="md"
              onClick={() => setModalConsentimento(false)}
            >
              Cancelar
            </Button>
            <Button
              size="md"
              disabled={!checkboxMarcado}
              onClick={handleConfirmarConsentimento}
              className="gap-2"
            >
              <ShieldCheck className="h-4 w-4" />
              Prosseguir
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <p className="text-sm text-gray-600 leading-relaxed">
            Em conformidade com a <strong>Lei Geral de Proteção de Dados (LGPD — Lei 13.709/2018)</strong>,
            a gravação de voz do cliente requer autorização expressa do titular.
          </p>
          <p className="text-sm text-gray-600 leading-relaxed">
            O áudio será utilizado exclusivamente para transcrição e apoio no registro do atendimento,
            sendo armazenado de forma segura e vinculado ao prontuário do cliente.
          </p>
          <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 p-3">
            <input
              type="checkbox"
              checked={checkboxMarcado}
              onChange={e => setCheckboxMarcado(e.target.checked)}
              className="mt-0.5 h-4 w-4 rounded border-gray-300 text-primary-600"
            />
            <span className="text-sm font-medium text-amber-900">
              Confirmo que o cliente autorizou expressamente a gravação desta consulta
            </span>
          </label>
        </div>
      </Dialog>

      {/* Controles de gravação */}
      <div className="space-y-3">
        <div className="flex items-center gap-3 flex-wrap">
          {estado === 'idle' && (
            <Button
              onClick={handleClicarGravar}
              disabled={desabilitado}
              size="lg"
              variant="default"
              className="gap-2"
            >
              <Mic className="h-5 w-5" />
              Gravar reunião
            </Button>
          )}

          {estado === 'gravando' && (
            <>
              <Button onClick={pausarGravacao} variant="secondary" size="md" className="gap-2">
                <Pause className="h-4 w-4" />
                Pausar
              </Button>
              <Button onClick={pararGravacaoFinal} variant="danger" size="md" className="gap-2">
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
              <Button onClick={pararGravacaoFinal} variant="danger" size="md" className="gap-2">
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
              {processandoChunk && (
                <span className="text-xs text-gray-400 flex items-center gap-1">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  salvando...
                </span>
              )}
            </div>
          )}
        </div>

        {/* Dica */}
        {estado === 'idle' && !desabilitado && (
          <p className="text-xs text-gray-400">
            {requerConsentimento
              ? 'Grave o atendimento com o cliente. O áudio será transcrito automaticamente pela IA. Limite de 60 minutos.'
              : 'Relate os fatos do caso com suas próprias palavras. O áudio será transcrito automaticamente pela IA. Limite de 60 minutos.'}
          </p>
        )}

        {desabilitado && estado === 'idle' && (
          <p className="text-xs text-amber-600">
            Selecione um cliente acima para habilitar a gravação.
          </p>
        )}

        {/* Erro */}
        {erro && (
          <p className="text-sm text-red-600">{erro}</p>
        )}
      </div>
    </>
  )
}
