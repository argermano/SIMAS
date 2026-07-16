import { NextResponse } from 'next/server'
import { getAuthContext } from '@/lib/auth'
import { jsonError } from '@/lib/api'

// DELETE /api/clientes/[id]/documentos/[docId] — remove um documento anexado
// DIRETO no dossiê (atendimento_id NULL) + seu arquivo do Storage. Docs que vieram
// de um atendimento se gerenciam no próprio caso (não são apagados por aqui).
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
    .select('id, file_url, atendimento_id, cliente_id')
    .eq('id', docId)
    .eq('cliente_id', clienteId)
    .eq('tenant_id', usuario.tenant_id)
    .single()
  if (!doc) return jsonError('Documento não encontrado', 404)

  // Só docs DIRETOS do dossiê. Docs de atendimento têm origem no caso.
  if (doc.atendimento_id) {
    return jsonError(
      'Este documento pertence a um atendimento — exclua-o dentro do caso de origem.',
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
