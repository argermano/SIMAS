import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import Groq from 'groq-sdk'

// POST /api/ia/transcrever-audio — transcrição rápida sem salvar no banco
// Usado pelo MicrofoneInline para o campo "Questão específica"
export async function POST(req: Request) {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })

  const formData  = await req.formData()
  const audioFile = formData.get('audio') as File | null

  if (!audioFile) {
    return NextResponse.json({ error: 'Nenhum arquivo de áudio enviado' }, { status: 400 })
  }

  const groqKey = process.env.GROQ_API_KEY
  if (!groqKey || groqKey === 'PREENCHA_AQUI') {
    return NextResponse.json(
      { error: 'GROQ_API_KEY não configurada' },
      { status: 503 }
    )
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
    return NextResponse.json({ error: `Erro na transcrição: ${message}` }, { status: 500 })
  }
}
