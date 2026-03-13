import { createClient } from '@/lib/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import Groq from 'groq-sdk'

export const maxDuration = 120

const MAX_AUDIO_SIZE = 500 * 1024 * 1024 // 500 MB

// POST — gera signed URL para upload direto ao Supabase Storage
export async function POST(req: Request) {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })

  const { data: usuario } = await supabase
    .from('users')
    .select('tenant_id')
    .eq('auth_user_id', user.id)
    .single()

  if (!usuario) return NextResponse.json({ error: 'Usuário não encontrado' }, { status: 404 })

  const { fileName, fileSize, atendimentoId } = await req.json() as {
    fileName: string
    fileSize: number
    atendimentoId: string
  }

  if (!fileName || !fileSize || !atendimentoId) {
    return NextResponse.json({ error: 'Dados obrigatórios ausentes' }, { status: 400 })
  }

  if (fileSize > MAX_AUDIO_SIZE) {
    return NextResponse.json({ error: 'Arquivo excede o limite de 500 MB' }, { status: 400 })
  }

  const { data: atendimento } = await supabase
    .from('atendimentos')
    .select('id')
    .eq('id', atendimentoId)
    .eq('tenant_id', usuario.tenant_id)
    .single()

  if (!atendimento) {
    return NextResponse.json({ error: 'Atendimento não encontrado' }, { status: 404 })
  }

  const timestamp = Date.now()
  const nomeSeguro = fileName.replace(/[^a-zA-Z0-9._-]/g, '_')
  const storagePath = `${usuario.tenant_id}/${atendimentoId}/audio_upload_${timestamp}_${nomeSeguro}`

  const adminSupabase = createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  const { data: signedData, error: signError } = await adminSupabase.storage
    .from('documentos')
    .createSignedUploadUrl(storagePath)

  if (signError || !signedData) {
    return NextResponse.json({ error: `Erro ao gerar URL de upload: ${signError?.message}` }, { status: 500 })
  }

  return NextResponse.json({
    uploadUrl:   signedData.signedUrl,
    uploadToken: signedData.token,
    storagePath,
  })
}

// PATCH — transcreve um arquivo de áudio já enviado ao Storage (deve ser <= 25MB)
// Para arquivos grandes, o client faz o chunking e envia múltiplos WAV chunks
export async function PATCH(req: Request) {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })

  const { data: usuario } = await supabase
    .from('users')
    .select('tenant_id')
    .eq('auth_user_id', user.id)
    .single()

  if (!usuario) return NextResponse.json({ error: 'Usuário não encontrado' }, { status: 404 })

  const { storagePath, atendimentoId, transcricaoAcumulada } = await req.json() as {
    storagePath: string
    atendimentoId: string
    transcricaoAcumulada?: string // texto acumulado de chunks anteriores (client envia junto no último)
  }

  if (!storagePath || !atendimentoId) {
    return NextResponse.json({ error: 'Dados obrigatórios ausentes' }, { status: 400 })
  }

  const groqKey = process.env.GROQ_API_KEY
  if (!groqKey || groqKey === 'PREENCHA_AQUI') {
    return NextResponse.json({ error: 'GROQ_API_KEY não configurada' }, { status: 503 })
  }

  // Baixa o arquivo do Storage
  const adminSupabase = createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  const { data: fileBlob, error: downloadError } = await adminSupabase.storage
    .from('documentos')
    .download(storagePath)

  if (downloadError || !fileBlob) {
    return NextResponse.json({ error: 'Erro ao baixar áudio do storage' }, { status: 500 })
  }

  // Determina extensão e mime type do arquivo
  const ext = storagePath.split('.').pop()?.toLowerCase() || 'wav'
  const mimeType = fileBlob.type || mimeFromExt(ext)

  // Cria File diretamente do Blob (preserva bytes originais)
  const file = new File([fileBlob], `audio.${ext}`, { type: mimeType })

  const groq = new Groq({ apiKey: groqKey })

  let transcricao = ''

  try {
    const transcription = await groq.audio.transcriptions.create({
      file,
      model:           'whisper-large-v3',
      language:        'pt',
      response_format: 'text',
    })

    transcricao = typeof transcription === 'string'
      ? transcription
      : (transcription as { text?: string }).text ?? ''
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Erro desconhecido'
    return NextResponse.json({ error: `Erro na transcrição: ${message}` }, { status: 500 })
  }

  // Se há transcrição acumulada de chunks anteriores, concatena
  const transcricaoFinal = transcricaoAcumulada
    ? transcricaoAcumulada + '\n' + transcricao
    : transcricao

  // Salva no atendimento
  const { data: atData } = await supabase
    .from('atendimentos')
    .select('audio_url')
    .eq('id', atendimentoId)
    .single()

  let audioPaths: string[] = []
  if (atData?.audio_url) {
    try {
      const parsed = JSON.parse(atData.audio_url)
      audioPaths = Array.isArray(parsed) ? parsed : [atData.audio_url]
    } catch {
      audioPaths = [atData.audio_url]
    }
  }
  audioPaths.push(storagePath)

  await supabase
    .from('atendimentos')
    .update({
      audio_url:       JSON.stringify(audioPaths),
      transcricao_raw: transcricaoFinal,
      modo_input:      'audio',
    })
    .eq('id', atendimentoId)

  return NextResponse.json({ transcricao: transcricaoFinal })
}

function mimeFromExt(ext: string): string {
  const map: Record<string, string> = {
    mp3: 'audio/mpeg',
    wav: 'audio/wav',
    m4a: 'audio/mp4',
    mp4: 'audio/mp4',
    ogg: 'audio/ogg',
    webm: 'audio/webm',
    mpeg: 'audio/mpeg',
    mpga: 'audio/mpeg',
  }
  return map[ext] || 'audio/mpeg'
}
