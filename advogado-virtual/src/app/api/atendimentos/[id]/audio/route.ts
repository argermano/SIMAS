import { createClient as createAdminClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import Groq from 'groq-sdk'
import { getAuthContext, type AuthContext, type Usuario } from '@/lib/auth'
import { jsonError } from '@/lib/api'
import { encryptField, decryptField } from '@/lib/encryption'
import { logTranscricao } from '@/lib/anthropic/usage'
import { validarAudio } from '@/lib/file-validation'

export const maxDuration = 120

// Tipo do client server-side (o mesmo que getAuthContext devolve no ramo ok).
type SupabaseServer = Extract<AuthContext, { ok: true }>['supabase']

// ─── Pipeline compartilhado ─────────────────────────────────────────────────
// Valida o tipo real do áudio, transcreve na Groq e acumula (APPEND) tanto o
// path quanto a transcrição cifrada. Usado pelos dois modos de entrada: o novo
// (chunk já no Storage, disparado por JSON) e o legado (multipart/formData).
async function transcreverEAcumular(opts: {
  supabase: SupabaseServer
  usuario: Usuario
  atendimentoId: string
  audioUrlAtual: string | null
  transcricaoRawAtual: string | null
  audioFile: File
  path: string
}): Promise<NextResponse> {
  const { supabase, usuario, atendimentoId, audioUrlAtual, transcricaoRawAtual, audioFile, path } = opts

  // Segurança (A8): confere os magic bytes — o file.type do cliente não é
  // confiável. Impede transcrever um arquivo disfarçado de áudio.
  const cabecalho = new Uint8Array(await audioFile.slice(0, 16).arrayBuffer())
  if (!validarAudio(cabecalho)) {
    return jsonError('O arquivo enviado não é um áudio reconhecido.', 400)
  }

  // Transcrição via Groq Whisper
  const groqKey = process.env.GROQ_API_KEY
  let transcricao = ''
  let segundosAudio = 0
  let houveTranscricao = false
  const inicioTranscricao = Date.now()

  if (groqKey && groqKey !== 'PREENCHA_AQUI') {
    const groq = new Groq({ apiKey: groqKey })

    // verbose_json em vez de 'text': dá a duração do áudio para registrar o
    // custo da transcrição (o texto retornado é o mesmo, sem timestamps).
    const transcription = await groq.audio.transcriptions.create({
      file: audioFile,
      model: 'whisper-large-v3',
      language: 'pt',
      response_format: 'verbose_json',
    })

    const result = transcription as { text?: string; duration?: number }
    transcricao = typeof transcription === 'string' ? transcription : (result.text ?? '')
    segundosAudio = result.duration ?? 0
    houveTranscricao = true
  } else {
    transcricao = '[Transcrição indisponível — configure GROQ_API_KEY no .env.local]'
  }

  // Acumula paths de áudio (todos os chunks ficam armazenados — são o registro
  // reproduzível do atendimento) a partir do valor lido na checagem de tenant.
  // Os uploads são serializados no cliente (GravadorAudio), o que torna este
  // read-modify-write seguro no fluxo normal.
  let audioPaths: string[] = []
  if (audioUrlAtual) {
    try {
      const parsed = JSON.parse(audioUrlAtual)
      audioPaths = Array.isArray(parsed) ? parsed : [audioUrlAtual]
    } catch {
      audioPaths = [audioUrlAtual]
    }
  }
  audioPaths.push(path)

  // Acumula a transcrição no servidor (APPEND, nunca sobrescrever): se a aba
  // fechar no meio de uma gravação longa, tudo que já foi transcrito permanece
  // salvo no banco. O valor no banco está cifrado — decifra antes de concatenar
  // (concatenar ciphertext geraria lixo).
  const anterior = decryptField(transcricaoRawAtual ?? '')
  let transcricaoCompleta = anterior
  const ehPlaceholder = transcricao.startsWith('[Transcrição indisponível')
  if (transcricao && !(ehPlaceholder && anterior.includes('[Transcrição indisponível'))) {
    transcricaoCompleta = anterior ? `${anterior}\n${transcricao}` : transcricao
  }

  const { error: updateError } = await supabase
    .from('atendimentos')
    .update({
      audio_url:        JSON.stringify(audioPaths),
      transcricao_raw:  encryptField(transcricaoCompleta), // cifrado; resposta devolve texto-plano
      modo_input:       'audio',
    })
    .eq('id', atendimentoId)

  if (updateError) {
    return jsonError(updateError.message, 500)
  }

  // Registra o custo da transcrição no painel de uso (só quando de fato houve
  // chamada à Groq). Não bloqueia a resposta em caso de falha de log.
  if (houveTranscricao) {
    await logTranscricao({
      tenantId:      usuario.tenant_id,
      userId:        usuario.id,
      endpoint:      'transcrever_gravacao',
      segundosAudio,
      latenciaMs:    Date.now() - inicioTranscricao,
    })
  }

  return NextResponse.json({
    transcricao,
    transcricao_completa: transcricaoCompleta,
    audio_url: path,
  })
}

// POST /api/atendimentos/[id]/audio — transcrição de um trecho de gravação.
//
// Dois modos:
//  • JSON  { storagePath, chunkNum? } — o gravador já subiu o chunk DIRETO ao
//    Storage (signed URL); a Vercel só baixa os bytes do bucket. É o caminho
//    padrão: mantém áudio longo fora do limite de body (~4.5MB) que perdia
//    gravações.
//  • formData { audio } — legado/compat (áudios pequenos, clientes antigos em
//    trânsito). O gravador NÃO usa mais este caminho.
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params

  const auth = await getAuthContext()
  if (!auth.ok) return auth.response
  const { supabase, usuario } = auth

  // Verifica se o atendimento pertence ao tenant (e carrega o acumulado atual)
  const { data: atendimento } = await supabase
    .from('atendimentos')
    .select('id, audio_url, transcricao_raw')
    .eq('id', id)
    .eq('tenant_id', usuario.tenant_id)
    .single()

  if (!atendimento) {
    return jsonError('Atendimento não encontrado', 404)
  }

  const audioUrlAtual = (atendimento.audio_url as string | null) ?? null
  const transcricaoRawAtual = (atendimento.transcricao_raw as string | null) ?? null
  const contentType = req.headers.get('content-type') ?? ''

  try {
    // ── Modo novo: o chunk já está no Storage (upload direto via signed URL) ──
    if (contentType.includes('application/json')) {
      const { storagePath } = await req.json() as { storagePath?: string; chunkNum?: number }
      if (!storagePath) {
        return jsonError('storagePath ausente', 400)
      }

      // Guarda de tenant: sem isto o admin client baixaria áudio de outro
      // tenant. Mesma proteção da rota /api/ia/transcrever-audio-upload.
      if (!storagePath.startsWith(`${usuario.tenant_id}/`)) {
        return jsonError('Caminho de arquivo inválido', 403)
      }

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

      const ext = storagePath.split('.').pop()?.toLowerCase() || 'webm'
      const audioFile = new File([fileBlob], `audio.${ext}`, {
        type: fileBlob.type || 'audio/webm',
      })

      return await transcreverEAcumular({
        supabase, usuario, atendimentoId: id,
        audioUrlAtual, transcricaoRawAtual, audioFile, path: storagePath,
      })
    }

    // ── Modo legado (compat): upload multipart pela própria Vercel ──
    const formData = await req.formData()
    const audioFile = formData.get('audio') as File | null

    if (!audioFile) {
      return jsonError('Nenhum arquivo de áudio enviado', 400)
    }

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
      return jsonError(`Upload falhou: ${uploadError.message}`, 500)
    }

    return await transcreverEAcumular({
      supabase, usuario, atendimentoId: id,
      audioUrlAtual, transcricaoRawAtual, audioFile, path,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Erro desconhecido'
    return jsonError(`Erro na transcrição: ${message}`, 500)
  }
}
