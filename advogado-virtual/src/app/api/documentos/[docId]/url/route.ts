import { NextRequest, NextResponse } from 'next/server'
import { getAuthContext } from '@/lib/auth'
import { jsonError } from '@/lib/api'

// GET /api/documentos/[docId]/url — gera URL assinada para visualizar/download do documento
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ docId: string }> }
) {
  const { docId } = await params

  const auth = await getAuthContext()
  if (!auth.ok) return auth.response
  const { supabase, usuario } = auth

  const { data: doc } = await supabase
    .from('documentos')
    .select('file_url, file_name, mime_type')
    .eq('id', docId)
    .eq('tenant_id', usuario.tenant_id)
    .single()

  if (!doc) return jsonError('Documento não encontrado', 404)

  const { data: urlData, error } = await supabase.storage
    .from('documentos')
    .createSignedUrl(doc.file_url, 3600) // 1 hora

  if (error || !urlData?.signedUrl) {
    return jsonError('Não foi possível gerar URL do documento', 500)
  }

  return NextResponse.json({
    url: urlData.signedUrl,
    file_name: doc.file_name,
    mime_type: doc.mime_type,
  })
}
