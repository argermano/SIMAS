import { NextResponse } from 'next/server'
import { getAuthContext } from '@/lib/auth'
import { jsonError } from '@/lib/api'
import { logTranscricao } from '@/lib/anthropic/usage'
import Groq from 'groq-sdk'

export const maxDuration = 120

// POST /api/ia/transcrever-audio — transcrição rápida sem salvar no banco
// Usado pelo MicrofoneInline para o campo "Questão específica"
export async function POST(req: Request) {
  const auth = await getAuthContext()
  if (!auth.ok) return auth.response
  const { usuario } = auth

  const formData  = await req.formData()
  const audioFile = formData.get('audio') as File | null

  if (!audioFile) {
    return jsonError('Nenhum arquivo de áudio enviado', 400)
  }

  const groqKey = process.env.GROQ_API_KEY
  if (!groqKey || groqKey === 'PREENCHA_AQUI') {
    return jsonError('GROQ_API_KEY não configurada', 503)
  }

  try {
    const groq = new Groq({ apiKey: groqKey })
    const start = Date.now()

    // verbose_json (em vez de 'text') para obter a duração do áudio e registrar
    // o custo da transcrição no api_usage_log.
    const transcription = await groq.audio.transcriptions.create({
      file:            audioFile,
      model:           'whisper-large-v3',
      language:        'pt',
      response_format: 'verbose_json',
    })

    const result = transcription as { text?: string; duration?: number }
    const transcricao = typeof transcription === 'string' ? transcription : (result.text ?? '')

    await logTranscricao({
      tenantId:      usuario.tenant_id,
      userId:        usuario.id,
      endpoint:      'transcrever_audio',
      segundosAudio: result.duration ?? 0,
      latenciaMs:    Date.now() - start,
    })

    return NextResponse.json({ transcricao })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Erro desconhecido'
    return jsonError(`Erro na transcrição: ${message}`, 500)
  }
}
