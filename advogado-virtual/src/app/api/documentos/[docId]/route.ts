import { NextRequest, NextResponse } from 'next/server'
import { getAuthContext } from '@/lib/auth'
import { jsonError } from '@/lib/api'

// DELETE /api/documentos/[docId] — remove o arquivo do storage e o registro do documento.
// Usado em "Documentos do caso" para excluir documentos gerados, um a um.
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ docId: string }> }
) {
  const { docId } = await params

  const auth = await getAuthContext()
  if (!auth.ok) return auth.response
  const { supabase, usuario } = auth

  const { data: doc } = await supabase
    .from('documentos')
    .select('id, file_url')
    .eq('id', docId)
    .eq('tenant_id', usuario.tenant_id)
    .single()

  if (!doc) return jsonError('Documento não encontrado', 404)

  // Remove o arquivo do storage (best-effort — segue mesmo se falhar)
  if (doc.file_url) {
    const { error: storageErr } = await supabase.storage.from('documentos').remove([doc.file_url])
    if (storageErr) {
      console.error('[documentos DELETE] falha ao remover do storage:', storageErr.message)
    }
  }

  const { error } = await supabase
    .from('documentos')
    .delete()
    .eq('id', docId)
    .eq('tenant_id', usuario.tenant_id)

  if (error) return jsonError(error.message, 500)

  return NextResponse.json({ ok: true })
}
