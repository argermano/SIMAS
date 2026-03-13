import { createClient } from '@/lib/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import Groq from 'groq-sdk'

// Vercel Pro: até 300s
export const maxDuration = 120

const MAX_AUDIO_SIZE = 500 * 1024 * 1024 // 500 MB
const CHUNK_SIZE     = 24 * 1024 * 1024   // 24 MB por chunk (limite Groq = 25MB)

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

  // Verifica se o atendimento pertence ao tenant
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

// PATCH — transcreve áudio já enviado ao Storage (com chunking automático se > 24MB)
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

  const { storagePath, atendimentoId } = await req.json() as {
    storagePath: string
    atendimentoId: string
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

  const { data: fileData, error: downloadError } = await adminSupabase.storage
    .from('documentos')
    .download(storagePath)

  if (downloadError || !fileData) {
    return NextResponse.json({ error: 'Erro ao baixar áudio do storage' }, { status: 500 })
  }

  const buffer = Buffer.from(await fileData.arrayBuffer())
  const groq = new Groq({ apiKey: groqKey })
  const ext = storagePath.split('.').pop() || 'mp3'

  let transcricao = ''

  try {
    if (buffer.length <= CHUNK_SIZE) {
      // Arquivo cabe em uma única requisição
      transcricao = await transcreverBuffer(groq, buffer, ext)
    } else {
      // Arquivo grande: dividir em chunks de ~24MB e transcrever cada um
      transcricao = await transcreverComChunking(groq, buffer, ext)
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Erro desconhecido'
    return NextResponse.json({ error: `Erro na transcrição: ${message}` }, { status: 500 })
  }

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
      transcricao_raw: transcricao,
      modo_input:      'audio',
    })
    .eq('id', atendimentoId)

  return NextResponse.json({ transcricao })
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function transcreverBuffer(groq: Groq, buffer: Buffer, ext: string): Promise<string> {
  const ab = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer
  const file = new File([ab], `audio.${ext}`, { type: mimeFromExt(ext) })

  const transcription = await groq.audio.transcriptions.create({
    file,
    model:           'whisper-large-v3',
    language:        'pt',
    response_format: 'text',
  })

  return typeof transcription === 'string'
    ? transcription
    : (transcription as { text?: string }).text ?? ''
}

async function transcreverComChunking(groq: Groq, buffer: Buffer, ext: string): Promise<string> {
  // Divide o buffer em pedaços de CHUNK_SIZE bytes
  const totalChunks = Math.ceil(buffer.length / CHUNK_SIZE)
  const resultados: string[] = []

  // Processa em lotes de 3 para não sobrecarregar a API
  const BATCH_SIZE = 3

  for (let i = 0; i < totalChunks; i += BATCH_SIZE) {
    const batchEnd = Math.min(i + BATCH_SIZE, totalChunks)
    const batchPromises: Promise<string>[] = []

    for (let j = i; j < batchEnd; j++) {
      const start = j * CHUNK_SIZE
      const end = Math.min(start + CHUNK_SIZE, buffer.length)
      const chunkBuffer = buffer.subarray(start, end)
      batchPromises.push(transcreverBuffer(groq, Buffer.from(chunkBuffer), ext))
    }

    const batchResults = await Promise.all(batchPromises)
    resultados.push(...batchResults)
  }

  return resultados.filter(Boolean).join('\n')
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
  return map[ext.toLowerCase()] || 'audio/mpeg'
}
