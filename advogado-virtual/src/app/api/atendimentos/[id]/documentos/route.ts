import { createClient as createAdminClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { getAuthContext } from '@/lib/auth'
import { jsonError } from '@/lib/api'
import { extractTextFromImage, extractTextFromPdf } from '@/lib/anthropic/client'

const MAX_FILE_SIZE = 50 * 1024 * 1024 // 50 MB

// POST /api/atendimentos/[id]/documentos — gera signed URL para upload direto + registra documento
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const auth = await getAuthContext()
  if (!auth.ok) return auth.response
  const { supabase, usuario } = auth

  const { data: atendimento } = await supabase
    .from('atendimentos')
    .select('id, cliente_id')
    .eq('id', id)
    .eq('tenant_id', usuario.tenant_id)
    .single()

  if (!atendimento) {
    return jsonError('Atendimento não encontrado', 404)
  }

  const body = await req.json()
  const { fileName, fileType, fileSize, tipo = 'outro' } = body as {
    fileName: string
    fileType: string
    fileSize: number
    tipo?: string
  }

  if (!fileName || !fileType || !fileSize) {
    return jsonError('Dados do arquivo são obrigatórios', 400)
  }

  if (fileSize > MAX_FILE_SIZE) {
    return jsonError(`Arquivo "${fileName}" excede o limite de 50 MB`, 400)
  }

  const timestamp = Date.now()
  const nomeSeguro = fileName.replace(/[^a-zA-Z0-9._-]/g, '_')
  const path = `${usuario.tenant_id}/${id}/docs/${timestamp}_${nomeSeguro}`

  // Gera signed URL para upload direto ao Supabase Storage (contorna limite do Vercel)
  const adminSupabase = createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  const { data: signedData, error: signError } = await adminSupabase.storage
    .from('documentos')
    .createSignedUploadUrl(path)

  if (signError || !signedData) {
    return jsonError(`Erro ao gerar URL de upload: ${signError?.message}`, 500)
  }

  // Insere registro na tabela documentos (texto será extraído depois)
  const { data: documento, error: insertError } = await supabase
    .from('documentos')
    .insert({
      atendimento_id: id,
      cliente_id:     atendimento.cliente_id ?? null,
      tenant_id:      usuario.tenant_id,
      tipo,
      file_url:       path,
      file_name:      fileName,
      mime_type:      fileType,
      tamanho_bytes:  fileSize,
      texto_extraido: null,
    })
    .select()
    .single()

  if (insertError) {
    return jsonError(insertError.message, 500)
  }

  // Nasce já "na pasta" do caso: além da origem (atendimento_id), cria a linha de
  // vínculo N:N (063) — é por ela que a tela do caso lista os documentos.
  const { error: vincErr } = await supabase
    .from('documento_vinculos')
    .insert({ tenant_id: usuario.tenant_id, documento_id: documento.id, atendimento_id: id })
  // LGPD: sem nome de arquivo no log — só id do doc e código do erro.
  if (vincErr) console.error('[atendimentos documentos POST] vínculo falhou:', documento.id, vincErr.code)

  return NextResponse.json({
    documento,
    uploadUrl: signedData.signedUrl,
    uploadToken: signedData.token,
    storagePath: path,
  }, { status: 201 })
}

// PATCH /api/atendimentos/[id]/documentos — extrai texto de documento já enviado
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const auth = await getAuthContext()
  if (!auth.ok) return auth.response
  const { supabase, usuario } = auth

  const body = await req.json()
  const { documentoId, storagePath, fileType } = body as {
    documentoId: string
    storagePath: string
    fileType: string
  }

  if (!documentoId || !storagePath) {
    return jsonError('Dados obrigatórios ausentes', 400)
  }

  // Baixa o arquivo do storage para extração de texto
  const adminSupabase = createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  const { data: fileData, error: downloadError } = await adminSupabase.storage
    .from('documentos')
    .download(storagePath)

  if (downloadError || !fileData) {
    return jsonError('Erro ao baixar arquivo para extração', 500)
  }

  const arrayBuffer = await fileData.arrayBuffer()
  let textoExtraido = ''
  const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp']

  if (fileType === 'application/pdf') {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const pdfParse = require('pdf-parse/lib/pdf-parse.js') as (buf: Buffer) => Promise<{ text: string }>
      const pdfData = await pdfParse(Buffer.from(arrayBuffer))
      textoExtraido = pdfData.text ?? ''

      if (textoExtraido.replace(/\s+/g, '').length < 50) {
        textoExtraido = ''
      }
    } catch {
      textoExtraido = ''
    }
  }

  if (IMAGE_TYPES.includes(fileType)) {
    try {
      const base64 = Buffer.from(arrayBuffer).toString('base64')
      textoExtraido = await extractTextFromImage({
        imageBase64: base64,
        mediaType: fileType as 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp',
      })
    } catch {
      textoExtraido = ''
    }
  } else if (fileType === 'application/pdf' && !textoExtraido) {
    try {
      const base64 = Buffer.from(arrayBuffer).toString('base64')
      textoExtraido = await extractTextFromPdf({ pdfBase64: base64 })
    } catch {
      textoExtraido = ''
    }
  }

  // Atualiza o documento com o texto extraído
  if (textoExtraido) {
    await supabase
      .from('documentos')
      .update({ texto_extraido: textoExtraido })
      .eq('id', documentoId)
      .eq('tenant_id', usuario.tenant_id)
  }

  return NextResponse.json({
    documento: { id: documentoId, texto_extraido: textoExtraido || null },
  })
}
