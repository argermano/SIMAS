import { createClient } from '@/lib/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { extractTextFromImage, extractTextFromPdf } from '@/lib/anthropic/client'

const MAX_FILE_SIZE = 50 * 1024 * 1024 // 50 MB

// POST /api/atendimentos/[id]/documentos — gera signed URL para upload direto + registra documento
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

  const { data: atendimento } = await supabase
    .from('atendimentos')
    .select('id, cliente_id')
    .eq('id', id)
    .eq('tenant_id', usuario.tenant_id)
    .single()

  if (!atendimento) {
    return NextResponse.json({ error: 'Atendimento não encontrado' }, { status: 404 })
  }

  const body = await req.json()
  const { fileName, fileType, fileSize, tipo = 'outro' } = body as {
    fileName: string
    fileType: string
    fileSize: number
    tipo?: string
  }

  if (!fileName || !fileType || !fileSize) {
    return NextResponse.json({ error: 'Dados do arquivo são obrigatórios' }, { status: 400 })
  }

  if (fileSize > MAX_FILE_SIZE) {
    return NextResponse.json({ error: `Arquivo "${fileName}" excede o limite de 50 MB` }, { status: 400 })
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
    return NextResponse.json({ error: `Erro ao gerar URL de upload: ${signError?.message}` }, { status: 500 })
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
    return NextResponse.json({ error: insertError.message }, { status: 500 })
  }

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
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })

  const { data: usuario } = await supabase
    .from('users')
    .select('tenant_id')
    .eq('auth_user_id', user.id)
    .single()

  if (!usuario) return NextResponse.json({ error: 'Usuário não encontrado' }, { status: 404 })

  const body = await req.json()
  const { documentoId, storagePath, fileType } = body as {
    documentoId: string
    storagePath: string
    fileType: string
  }

  if (!documentoId || !storagePath) {
    return NextResponse.json({ error: 'Dados obrigatórios ausentes' }, { status: 400 })
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
    return NextResponse.json({ error: 'Erro ao baixar arquivo para extração' }, { status: 500 })
  }

  const arrayBuffer = await fileData.arrayBuffer()
  let textoExtraido = ''
  const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp']

  if (fileType === 'application/pdf') {
    try {
      const pdfMod = await import('pdf-parse')
      const pdfParse = (pdfMod as unknown as { default: (buf: Buffer) => Promise<{ text: string }> }).default
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
