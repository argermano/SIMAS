import { createClient } from '@/lib/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import Groq from 'groq-sdk'
import { tmpdir } from 'os'
import { join } from 'path'
import { writeFile, readFile, unlink, readdir, mkdir } from 'fs/promises'

// Vercel Pro: até 300s
export const maxDuration = 120

const MAX_AUDIO_SIZE = 500 * 1024 * 1024 // 500 MB
const GROQ_LIMIT     = 25 * 1024 * 1024  // 25 MB
const SEGMENT_TIME   = 600                // 10 minutos por chunk

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

// PATCH — transcreve áudio já enviado ao Storage (com chunking automático se > 25MB)
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

  let transcricao = ''

  try {
    if (buffer.length <= GROQ_LIMIT) {
      // Arquivo cabe em uma única requisição
      transcricao = await transcreverBuffer(groq, buffer, storagePath)
    } else {
      // Arquivo grande: dividir com ffmpeg e transcrever por partes
      transcricao = await transcreverComChunking(groq, buffer, storagePath)
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

async function transcreverBuffer(groq: Groq, buffer: Buffer, fileName: string): Promise<string> {
  const ext = fileName.split('.').pop() || 'webm'
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

async function transcreverComChunking(groq: Groq, buffer: Buffer, originalName: string): Promise<string> {
  const ext = originalName.split('.').pop() || 'mp3'
  const workDir = join(tmpdir(), `simas_audio_${Date.now()}`)
  await mkdir(workDir, { recursive: true })

  const inputPath = join(workDir, `input.${ext}`)
  await writeFile(inputPath, buffer)

  try {
    // Usa ffmpeg para dividir em segmentos de 10 min
    const chunkPaths = await splitWithFfmpeg(inputPath, workDir, ext)

    if (chunkPaths.length === 0) {
      // Fallback: tenta transcrever o arquivo inteiro (pode falhar se > 25MB)
      return await transcreverBuffer(groq, buffer, originalName)
    }

    // Transcreve cada chunk em paralelo (máximo 3 simultâneos)
    const resultados: string[] = []
    const BATCH_SIZE = 3

    for (let i = 0; i < chunkPaths.length; i += BATCH_SIZE) {
      const batch = chunkPaths.slice(i, i + BATCH_SIZE)
      const batchResults = await Promise.all(
        batch.map(async (chunkPath) => {
          const chunkBuffer = await readFile(chunkPath)
          return transcreverBuffer(groq, chunkBuffer, chunkPath)
        })
      )
      resultados.push(...batchResults)
    }

    return resultados.filter(Boolean).join('\n')
  } finally {
    // Limpa arquivos temporários
    try {
      const files = await readdir(workDir)
      await Promise.all(files.map(f => unlink(join(workDir, f)).catch(() => {})))
      const { rmdir } = await import('fs/promises')
      await rmdir(workDir).catch(() => {})
    } catch { /* silencioso */ }
  }
}

async function splitWithFfmpeg(inputPath: string, outputDir: string, ext: string): Promise<string[]> {
  const ffmpegPath = await getFfmpegPath()
  if (!ffmpegPath) {
    throw new Error('ffmpeg não disponível no servidor')
  }

  const outputPattern = join(outputDir, `chunk_%03d.${ext}`)

  const { execFile } = await import('child_process')
  const { promisify } = await import('util')
  const execFileAsync = promisify(execFile)

  await execFileAsync(ffmpegPath, [
    '-i', inputPath,
    '-f', 'segment',
    '-segment_time', String(SEGMENT_TIME),
    '-c', 'copy',
    '-y',
    outputPattern,
  ], { timeout: 60000 })

  const files = await readdir(outputDir)
  return files
    .filter(f => f.startsWith('chunk_'))
    .sort()
    .map(f => join(outputDir, f))
}

async function getFfmpegPath(): Promise<string | null> {
  try {
    const ffmpegStatic = await import('ffmpeg-static')
    const p = (ffmpegStatic as unknown as { default: string }).default ?? ffmpegStatic
    return typeof p === 'string' ? p : null
  } catch {
    return null
  }
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
