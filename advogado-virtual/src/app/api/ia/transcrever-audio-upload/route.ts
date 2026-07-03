import { createClient as createAdminClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { getAuthContext } from '@/lib/auth'
import { jsonError } from '@/lib/api'
import { encryptField } from '@/lib/encryption'
import { logTranscricao } from '@/lib/anthropic/usage'
import Groq from 'groq-sdk'

export const maxDuration = 120

const MAX_AUDIO_SIZE = 500 * 1024 * 1024 // 500 MB

// POST — gera signed URL para upload direto ao Supabase Storage
export async function POST(req: Request) {
  const auth = await getAuthContext()
  if (!auth.ok) return auth.response
  const { supabase, usuario } = auth

  const { fileName, fileSize, atendimentoId } = await req.json() as {
    fileName: string
    fileSize: number
    atendimentoId: string
  }

  if (!fileName || !fileSize || !atendimentoId) {
    return jsonError('Dados obrigatórios ausentes', 400)
  }

  if (fileSize > MAX_AUDIO_SIZE) {
    return jsonError('Arquivo excede o limite de 500 MB', 400)
  }

  const { data: atendimento } = await supabase
    .from('atendimentos')
    .select('id')
    .eq('id', atendimentoId)
    .eq('tenant_id', usuario.tenant_id)
    .single()

  if (!atendimento) {
    return jsonError('Atendimento não encontrado', 404)
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
    return jsonError(`Erro ao gerar URL de upload: ${signError?.message}`, 500)
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
  const auth = await getAuthContext()
  if (!auth.ok) return auth.response
  const { supabase, usuario } = auth

  const { storagePath, atendimentoId, transcricaoAcumulada, timeOffset } = await req.json() as {
    storagePath: string
    atendimentoId: string
    transcricaoAcumulada?: string // texto acumulado de chunks anteriores (client envia junto no último)
    timeOffset?: number // offset em segundos para ajustar timestamps de chunks
  }

  if (!storagePath || !atendimentoId) {
    return jsonError('Dados obrigatórios ausentes', 400)
  }

  // O atendimento precisa pertencer ao tenant do usuário (RLS),
  // e o caminho no storage precisa estar sob o prefixo do tenant —
  // caso contrário o admin client baixaria áudio de outro tenant.
  const { data: atendimentoDoTenant } = await supabase
    .from('atendimentos')
    .select('id')
    .eq('id', atendimentoId)
    .eq('tenant_id', usuario.tenant_id)
    .single()

  if (!atendimentoDoTenant) {
    return jsonError('Atendimento não encontrado', 404)
  }

  if (!storagePath.startsWith(`${usuario.tenant_id}/`)) {
    return jsonError('Caminho de arquivo inválido', 403)
  }

  const groqKey = process.env.GROQ_API_KEY
  if (!groqKey || groqKey === 'PREENCHA_AQUI') {
    return jsonError('GROQ_API_KEY não configurada', 503)
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
    return jsonError('Erro ao baixar áudio do storage', 500)
  }

  // Determina extensão e mime type do arquivo
  const ext = storagePath.split('.').pop()?.toLowerCase() || 'wav'
  const mimeType = fileBlob.type || mimeFromExt(ext)

  // Cria File diretamente do Blob (preserva bytes originais)
  const file = new File([fileBlob], `audio.${ext}`, { type: mimeType })

  const groq = new Groq({ apiKey: groqKey })

  let transcricao = ''
  let segundosAudio = 0
  const inicioTranscricao = Date.now()

  try {
    const transcription = await comRetry(() => groq.audio.transcriptions.create({
      file,
      model:                  'whisper-large-v3',
      language:               'pt',
      response_format:        'verbose_json',
      timestamp_granularities: ['segment'],
    }))

    // verbose_json retorna segments com timestamps
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = transcription as any
    segundosAudio = Number(result?.duration) || 0
    console.log('[transcrever-audio] response keys:', Object.keys(result), 'segments count:', result?.segments?.length ?? 0)

    if (result?.segments && Array.isArray(result.segments) && result.segments.length > 0) {
      transcricao = formatSegments(result.segments, timeOffset || 0)
    } else if (result?.text) {
      transcricao = result.text
    } else if (typeof transcription === 'string') {
      transcricao = transcription
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Erro desconhecido'
    return jsonError(`Erro na transcrição: ${message}`, 500)
  }

  // Se há transcrição acumulada de chunks anteriores, concatena
  const transcricaoFinal = transcricaoAcumulada
    ? transcricaoAcumulada + '\n' + transcricao
    : transcricao

  // WAV chunks gerados pelo client (browser chunking) são descartáveis após transcrição:
  // ocupam ~7.5 MB/4min cada e o usuário só precisa do texto. Apenas o áudio original
  // (uploads < 25 MB) é preservado para replay.
  const isChunk = /audio_upload_.*chunk_\d+\.wav$/i.test(storagePath)

  if (isChunk) {
    const { error: removeError } = await adminSupabase.storage
      .from('documentos')
      .remove([storagePath])
    if (removeError) {
      console.error('[transcrever-audio] falha ao remover chunk pós-transcrição', {
        storagePath,
        error: removeError.message,
      })
    }
  }

  // Salva no atendimento — chunks não vão pro audio_url (foram deletados)
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
  if (!isChunk) audioPaths.push(storagePath)

  const { error: updateError } = await supabase
    .from('atendimentos')
    .update({
      audio_url:       audioPaths.length > 0 ? JSON.stringify(audioPaths) : null,
      transcricao_raw: encryptField(transcricaoFinal), // cifrado em repouso; resposta devolve texto-plano
      modo_input:      'audio',
    })
    .eq('id', atendimentoId)
    .eq('tenant_id', usuario.tenant_id)

  if (updateError) {
    console.error('[transcrever-audio] falha ao salvar transcrição:', updateError.message)
    return jsonError('Transcrição concluída, mas falhou ao salvar no atendimento. Tente novamente.', 500)
  }

  // Registra o custo desta transcrição (por segundo de áudio) no painel de uso.
  await logTranscricao({
    tenantId:      usuario.tenant_id,
    userId:        usuario.id,
    endpoint:      'transcrever_upload',
    segundosAudio,
    latenciaMs:    Date.now() - inicioTranscricao,
  })

  return NextResponse.json({ transcricao: transcricaoFinal })
}

/** Retry com backoff exponencial (1s, 2s, 4s) para erros transientes da Groq. */
async function comRetry<T>(fn: () => Promise<T>, tentativas = 3): Promise<T> {
  let ultimoErro: unknown
  for (let i = 0; i < tentativas; i++) {
    try {
      return await fn()
    } catch (err) {
      ultimoErro = err
      if (i < tentativas - 1) {
        const espera = 1000 * 2 ** i
        console.warn(`[transcrever-audio] retry ${i + 1}/${tentativas} após erro: ${err instanceof Error ? err.message : err}`)
        await new Promise((r) => setTimeout(r, espera))
      }
    }
  }
  throw ultimoErro
}

function formatTimestamp(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = Math.floor(seconds % 60)
  return h > 0
    ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
    : `${m}:${String(s).padStart(2, '0')}`
}

function formatSegments(segments: Array<{ start: number; end: number; text: string }>, offset: number = 0): string {
  const PAUSE_THRESHOLD = 2.0 // segundos de pausa para criar novo parágrafo
  const lines: string[] = []
  let currentParagraph = ''
  let paragraphStart = -1

  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i]
    const text = seg.text.trim()
    if (!text) continue

    const isNewParagraph = i === 0
      || (seg.start - segments[i - 1].end > PAUSE_THRESHOLD)

    if (isNewParagraph && currentParagraph) {
      lines.push(`[${formatTimestamp(paragraphStart + offset)}] ${currentParagraph.trim()}`)
      currentParagraph = ''
    }

    if (!currentParagraph) {
      paragraphStart = seg.start
    }
    currentParagraph += ' ' + text
  }

  if (currentParagraph) {
    lines.push(`[${formatTimestamp(paragraphStart + offset)}] ${currentParagraph.trim()}`)
  }

  return lines.join('\n\n')
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
