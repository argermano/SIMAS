import { NextResponse } from 'next/server'
import { getAuthContext } from '@/lib/auth'
import { jsonError } from '@/lib/api'

// DELETE /api/clientes/[id]/documentos/[docId] — remove um documento GERAL do
// dossiê (sem vínculo de caso nem de processo) + seu arquivo do Storage. Docs
// vinculados exigem DESVINCULAR antes (mais seguro: não some arquivo por engano).
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string; docId: string }> },
) {
  const { id: clienteId, docId } = await params
  const auth = await getAuthContext()
  if (!auth.ok) return auth.response
  const { supabase, usuario } = auth

  const { data: doc } = await supabase
    .from('documentos')
    .select('id, file_url, atendimento_id, processo_id, cliente_id')
    .eq('id', docId)
    .eq('cliente_id', clienteId)
    .eq('tenant_id', usuario.tenant_id)
    .single()
  if (!doc) return jsonError('Documento não encontrado', 404)

  // Só docs GERAIS. Vinculado a caso/processo → desvincule primeiro (evita
  // apagar por engano um arquivo que está servindo a um caso ou processo).
  if (doc.atendimento_id || doc.processo_id) {
    return jsonError(
      'Este documento está vinculado a um caso ou processo — desvincule antes de excluir.',
      409,
    )
  }

  // Remove o arquivo do Storage (best-effort — segue mesmo se falhar).
  if (doc.file_url) {
    const { error: storageErr } = await supabase.storage
      .from('documentos')
      .remove([doc.file_url])
    if (storageErr) {
      // Sem nome/conteúdo do arquivo no log (LGPD): só o id.
      console.error('[clientes documentos DELETE] falha ao remover do storage:', doc.id)
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
