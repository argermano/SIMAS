import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

// GET /api/documentos/[docId]/url — gera URL assinada para visualizar/download do documento
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ docId: string }> }
) {
  const { docId } = await params
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })

  const { data: usuario } = await supabase
    .from('users')
    .select('tenant_id')
    .eq('auth_user_id', user.id)
    .single()

  if (!usuario) return NextResponse.json({ error: 'Usuário não encontrado' }, { status: 404 })

  const { data: doc } = await supabase
    .from('documentos')
    .select('file_url, file_name, mime_type')
    .eq('id', docId)
    .eq('tenant_id', usuario.tenant_id)
    .single()

  if (!doc) return NextResponse.json({ error: 'Documento não encontrado' }, { status: 404 })

  const { data: urlData, error } = await supabase.storage
    .from('documentos')
    .createSignedUrl(doc.file_url, 7200) // 2 horas

  if (error || !urlData?.signedUrl) {
    return NextResponse.json({ error: 'Não foi possível gerar URL do documento' }, { status: 500 })
  }

  return NextResponse.json({
    url: urlData.signedUrl,
    file_name: doc.file_name,
    mime_type: doc.mime_type,
  })
}
