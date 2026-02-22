import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import Groq from 'groq-sdk'

// POST /api/atendimentos/[id]/audio — upload áudio + transcrição Groq
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })

  const { data: usuario } = await supabase
    .from('users')
    .select('tenant_id')
    .eq('auth_user_id', user.id)
    .single()

  if (!usuario) return NextResponse.json({ error: 'Usuário não encontrado' }, { status: 404 })

  // Verifica se o atendimento pertence ao tenant
  const { data: atendimento } = await supabase
    .from('atendimentos')
    .select('id')
    .eq('id', id)
    .eq('tenant_id', usuario.tenant_id)
    .single()

  if (!atendimento) {
    return NextResponse.json({ error: 'Atendimento não encontrado' }, { status: 404 })
  }

  // Extrai o arquivo de áudio do FormData
  const formData = await req.formData()
  const audioFile = formData.get('audio') as File | null

  if (!audioFile) {
    return NextResponse.json({ error: 'Nenhum arquivo de áudio enviado' }, { status: 400 })
  }

  try {
    // 1. Upload para Supabase Storage
    const timestamp = Date.now()
    const path = `${usuario.tenant_id}/${id}/audio_${timestamp}.webm`
    const arrayBuffer = await audioFile.arrayBuffer()

    const { error: uploadError } = await supabase.storage
      .from('documentos')
      .upload(path, arrayBuffer, {
        contentType: audioFile.type || 'audio/webm',
        upsert: true,
      })

    if (uploadError) {
      return NextResponse.json({ error: `Upload falhou: ${uploadError.message}` }, { status: 500 })
    }

    // 2. Transcrição via Groq Whisper
    const groqKey = process.env.GROQ_API_KEY
    let transcricao = ''

    if (groqKey && groqKey !== 'PREENCHA_AQUI') {
      const groq = new Groq({ apiKey: groqKey })

      const transcription = await groq.audio.transcriptions.create({
        file: audioFile,
        model: 'whisper-large-v3',
        language: 'pt',
        response_format: 'text',
      })

      transcricao = typeof transcription === 'string'
        ? transcription
        : (transcription as { text?: string }).text ?? ''
    } else {
      transcricao = '[Transcrição indisponível — configure GROQ_API_KEY no .env.local]'
    }

    // 3. Atualiza o atendimento com áudio e transcrição
    const { error: updateError } = await supabase
      .from('atendimentos')
      .update({
        audio_url:        path,
        transcricao_raw:  transcricao,
        modo_input:       'audio',
      })
      .eq('id', id)

    if (updateError) {
      return NextResponse.json({ error: updateError.message }, { status: 500 })
    }

    return NextResponse.json({
      transcricao,
      audio_url: path,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Erro desconhecido'
    return NextResponse.json({ error: `Erro na transcrição: ${message}` }, { status: 500 })
  }
}
