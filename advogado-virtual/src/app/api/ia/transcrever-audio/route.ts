import { NextResponse } from 'next/server'
import { getAuthContext } from '@/lib/auth'
import { jsonError } from '@/lib/api'
import Groq from 'groq-sdk'

// POST /api/ia/transcrever-audio — transcrição rápida sem salvar no banco
// Usado pelo MicrofoneInline para o campo "Questão específica"
export async function POST(req: Request) {
  const auth = await getAuthContext()
  if (!auth.ok) return auth.response

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

    const transcription = await groq.audio.transcriptions.create({
      file:            audioFile,
      model:           'whisper-large-v3',
      language:        'pt',
      response_format: 'text',
    })

    const transcricao = typeof transcription === 'string'
      ? transcription
      : (transcription as { text?: string }).text ?? ''

    return NextResponse.json({ transcricao })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Erro desconhecido'
    return jsonError(`Erro na transcrição: ${message}`, 500)
  }
}
