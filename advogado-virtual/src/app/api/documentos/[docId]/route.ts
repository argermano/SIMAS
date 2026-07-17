import { NextRequest, NextResponse } from 'next/server'
import { getAuthContext } from '@/lib/auth'
import { jsonError } from '@/lib/api'

// DELETE /api/documentos/[docId] — remove o arquivo do storage e o registro do documento.
// Só apaga o arquivo de fato quando ele NÃO está em nenhuma pasta (nenhum vínculo
// N:N, 063): um doc compartilhado entre casos/processos é atalho e não pode sumir
// por engano de um deles. Enquanto houver vínculo → 409 (desvincule das pastas).
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

  // Bloqueia enquanto o doc estiver em alguma pasta (caso/processo).
  const { count: vinculos } = await supabase
    .from('documento_vinculos')
    .select('id', { count: 'exact', head: true })
    .eq('documento_id', docId)
    .eq('tenant_id', usuario.tenant_id)
  if ((vinculos ?? 0) > 0) {
    return jsonError(
      'Este documento está em uma ou mais pastas (casos/processos) — desvincule dessas pastas antes de excluir.',
      409,
    )
  }

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
