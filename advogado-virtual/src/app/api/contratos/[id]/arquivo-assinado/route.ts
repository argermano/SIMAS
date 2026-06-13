import { createClient as createAdminClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { getAuthContext } from '@/lib/auth'
import { jsonError } from '@/lib/api'

const MAX_FILE_SIZE = 50 * 1024 * 1024 // 50 MB

function adminStorage() {
  return createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  ).storage.from('documentos')
}

// POST /api/contratos/[id]/arquivo-assinado — signed URL para upload do contrato assinado
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params

  const auth = await getAuthContext()
  if (!auth.ok) return auth.response
  const { supabase, usuario } = auth

  if (!['admin', 'advogado'].includes(usuario.role)) {
    return jsonError('Sem permissão para importar o contrato assinado', 403)
  }

  const { data: contrato } = await supabase
    .from('contratos_honorarios')
    .select('id')
    .eq('id', id)
    .eq('tenant_id', usuario.tenant_id)
    .single()
  if (!contrato) return jsonError('Contrato não encontrado', 404)

  const { fileName, fileType, fileSize } = await req.json() as {
    fileName: string; fileType: string; fileSize: number
  }
  if (!fileName || !fileType || !fileSize) {
    return jsonError('Dados do arquivo são obrigatórios', 400)
  }
  if (fileSize > MAX_FILE_SIZE) {
    return jsonError(`Arquivo "${fileName}" excede o limite de 50 MB`, 400)
  }

  const nomeSeguro = fileName.replace(/[^a-zA-Z0-9._-]/g, '_')
  const path = `${usuario.tenant_id}/contratos/${id}/assinado_${Date.now()}_${nomeSeguro}`

  const { data: signed, error } = await adminStorage().createSignedUploadUrl(path)
  if (error || !signed) {
    return jsonError(`Erro ao gerar URL de upload: ${error?.message}`, 500)
  }

  return NextResponse.json(
    { uploadUrl: signed.signedUrl, uploadToken: signed.token, storagePath: path },
    { status: 201 },
  )
}

// PATCH /api/contratos/[id]/arquivo-assinado — confirma o upload e marca como assinado
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params

  const auth = await getAuthContext()
  if (!auth.ok) return auth.response
  const { supabase, usuario } = auth

  if (!['admin', 'advogado'].includes(usuario.role)) {
    return jsonError('Sem permissão para importar o contrato assinado', 403)
  }

  const { storagePath, fileName } = await req.json() as { storagePath: string; fileName?: string }
  if (!storagePath) return jsonError('storagePath é obrigatório', 400)

  const { data: atualizado, error } = await supabase
    .from('contratos_honorarios')
    .update({
      arquivo_assinado_url:  storagePath,
      arquivo_assinado_nome: fileName ?? null,
      status:                'assinado',
      assinado_em:           new Date().toISOString(),
      assinado_por:          usuario.id,
    })
    .eq('id', id)
    .eq('tenant_id', usuario.tenant_id)
    .select('id, status, assinado_em, arquivo_assinado_nome')
    .single()

  if (error) return jsonError(error.message, 500)
  if (!atualizado) return jsonError('Contrato não encontrado', 404)

  return NextResponse.json({ contrato: atualizado })
}

// GET /api/contratos/[id]/arquivo-assinado — URL assinada para baixar o contrato assinado
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params

  const auth = await getAuthContext()
  if (!auth.ok) return auth.response
  const { supabase, usuario } = auth

  const { data: contrato } = await supabase
    .from('contratos_honorarios')
    .select('arquivo_assinado_url')
    .eq('id', id)
    .eq('tenant_id', usuario.tenant_id)
    .single()

  if (!contrato?.arquivo_assinado_url) {
    return jsonError('Nenhum arquivo assinado importado para este contrato', 404)
  }

  const { data: signed, error } = await adminStorage().createSignedUrl(contrato.arquivo_assinado_url, 300)
  if (error || !signed) return jsonError('Erro ao gerar URL de download', 500)

  return NextResponse.json({ url: signed.signedUrl })
}
