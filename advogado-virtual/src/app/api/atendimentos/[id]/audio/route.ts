import { NextResponse } from 'next/server'
import Groq from 'groq-sdk'
import { getAuthContext } from '@/lib/auth'
import { jsonError } from '@/lib/api'
import { encryptField, decryptField } from '@/lib/encryption'
import { logTranscricao } from '@/lib/anthropic/usage'
import { validarAudio } from '@/lib/file-validation'

export const maxDuration = 120

// POST /api/atendimentos/[id]/audio — upload áudio + transcrição Groq
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

  // Extrai o arquivo de áudio do FormData
  const formData = await req.formData()
  const audioFile = formData.get('audio') as File | null

  if (!audioFile) {
    return jsonError('Nenhum arquivo de áudio enviado', 400)
  }

  try {
    // 1. Upload para Supabase Storage
    const timestamp = Date.now()
    const path = `${usuario.tenant_id}/${id}/audio_${timestamp}.webm`
    const arrayBuffer = await audioFile.arrayBuffer()

    // Segurança (A8): confere os magic bytes — o file.type do cliente não é
    // confiável. Impede subir/transcrever um arquivo disfarçado de áudio.
    if (!validarAudio(new Uint8Array(arrayBuffer.slice(0, 16)))) {
      return jsonError('O arquivo enviado não é um áudio reconhecido.', 400)
    }

    const { error: uploadError } = await supabase.storage
      .from('documentos')
      .upload(path, arrayBuffer, {
        contentType: audioFile.type || 'audio/webm',
        upsert: true,
      })

    if (uploadError) {
      return jsonError(`Upload falhou: ${uploadError.message}`, 500)
    }

    // 2. Transcrição via Groq Whisper
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

    // 3. Acumula paths de áudio (todos os chunks ficam armazenados — são o
    // registro reproduzível do atendimento) usando o valor lido na checagem
    // de tenant. Os uploads são serializados no cliente (GravadorAudio), o que
    // torna este read-modify-write seguro no fluxo normal.
    let audioPaths: string[] = []
    if (atendimento.audio_url) {
      try {
        const parsed = JSON.parse(atendimento.audio_url)
        audioPaths = Array.isArray(parsed) ? parsed : [atendimento.audio_url]
      } catch {
        audioPaths = [atendimento.audio_url]
      }
    }
    audioPaths.push(path)

    // 4. Acumula a transcrição no servidor (APPEND, nunca sobrescrever):
    // se a aba fechar no meio de uma gravação longa, tudo que já foi
    // transcrito permanece salvo no banco. O valor no banco está cifrado —
    // decifra antes de concatenar (concatenar ciphertext geraria lixo).
    const anterior = decryptField((atendimento.transcricao_raw as string | null) ?? '')
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
      .eq('id', id)

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
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Erro desconhecido'
    return jsonError(`Erro na transcrição: ${message}`, 500)
  }
}
