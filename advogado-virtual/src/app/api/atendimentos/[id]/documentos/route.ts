import { createClient as createAdminClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { getAuthContext } from '@/lib/auth'
import { jsonError } from '@/lib/api'
import { extrairTexto, MAX_EXTRACT_BYTES } from '@/lib/documentos/extrair-texto'
import { enfileirarDriveSync } from '@/lib/drive/fila'

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

  // Gatilho do espelho no Drive. O arquivo real ainda vai ser enviado pelo browser
  // (URL assinada) — se a drenagem correr antes dos bytes chegarem, o item falha e a
  // fila durável o retenta no próximo ciclo (a drenagem é diária / sob demanda).
  await enfileirarDriveSync(adminSupabase, usuario.tenant_id, atendimento.cliente_id)

  return NextResponse.json({
    documento,
    uploadUrl: signedData.signedUrl,
    uploadToken: signedData.token,
    storagePath: path,
  }, { status: 201 })
}

const schemaExtrair = z.object({
  documentoId: z.string().uuid(),
  // fileType é só uma dica de qual extrator usar; o path do Storage vem do banco.
  fileType:    z.string().optional(),
})

// PATCH /api/atendimentos/[id]/documentos — extrai texto de documento já enviado
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const auth = await getAuthContext()
  if (!auth.ok) return auth.response
  const { supabase, usuario } = auth

  const parsed = schemaExtrair.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return jsonError('Dados obrigatórios ausentes', 400)
  }
  const { documentoId } = parsed.data

  // Confere a posse do atendimento pai no tenant (mesmo guard do POST).
  const { data: atendimento } = await supabase
    .from('atendimentos')
    .select('id')
    .eq('id', id)
    .eq('tenant_id', usuario.tenant_id)
    .single()
  if (!atendimento) {
    return jsonError('Atendimento não encontrado', 404)
  }

  // IDOR: o path do Storage NUNCA vem do cliente — o admin client abaixo ignora
  // a RLS e baixaria arquivo de qualquer tenant. Resolve o documento por id +
  // tenant (amarrado a este atendimento) e usa o file_url PERSISTIDO para baixar
  // (padrão de documentos/[docId]/extrair).
  const { data: documento } = await supabase
    .from('documentos')
    .select('id, file_url, mime_type')
    .eq('id', documentoId)
    .eq('tenant_id', usuario.tenant_id)
    .eq('atendimento_id', id)
    .single()
  if (!documento?.file_url) {
    return jsonError('Documento não encontrado', 404)
  }

  const storagePath = documento.file_url
  const fileType = parsed.data.fileType ?? documento.mime_type ?? ''

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
  // Teto único de extração + fallback OCR (PDF→Claude, imagens via Claude) centralizados.
  const { texto: textoExtraido } = await extrairTexto(Buffer.from(arrayBuffer), {
    mime:     fileType,
    fileName: '',
    maxBytes: MAX_EXTRACT_BYTES,
    ocr:      true,
  })

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
