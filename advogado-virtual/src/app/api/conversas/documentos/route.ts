import { NextRequest, NextResponse } from 'next/server'
import { getAuthContext, requireRole } from '@/lib/auth'
import { jsonError } from '@/lib/api'
import { TIPOS_ANEXO_PERMITIDOS } from '@/lib/conversas/anexos'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// GET /api/conversas/documentos?clienteId=&q= — lista LEVE de documentos do
// tenant que PODEM ser enviados ao cliente (só tipos da allowlist de anexo).
// Devolve id/nome/tipo/mime/tamanho, no máx. 30. Usado pelo AnexarDocumentoModal.
// (As rotas /api/documentos existentes descriptografam/pesam mais do que o picker
// precisa; por isso esta é dedicada e enxuta — igual ao /conversas/clientes.)
export async function GET(req: NextRequest) {
  const auth = await getAuthContext()
  if (!auth.ok) return auth.response
  const gate = requireRole(auth.usuario, ['admin', 'advogado', 'colaborador'])
  if (gate) return gate
  const { supabase, usuario } = auth

  const { searchParams } = new URL(req.url)
  const q = (searchParams.get('q') ?? '').trim()
  const clienteId = (searchParams.get('clienteId') ?? '').trim()

  let query = supabase
    .from('documentos')
    .select('id, file_name, tipo, mime_type, tamanho_bytes')
    .eq('tenant_id', usuario.tenant_id)
    // só o que dá para enviar de fato: arquivo presente e tipo aceito.
    .not('file_url', 'is', null)
    .in('mime_type', Array.from(TIPOS_ANEXO_PERMITIDOS))
    .order('created_at', { ascending: false })
    .limit(30)
  // uuid inválido é ignorado (evita 500 no cast do Postgres).
  if (clienteId && UUID_RE.test(clienteId)) query = query.eq('cliente_id', clienteId)
  if (q) query = query.ilike('file_name', `%${q}%`)

  const { data, error } = await query
  if (error) return jsonError(error.message, 500)

  const documentos = (data ?? []).map((d) => ({
    id: d.id,
    nome: d.file_name,
    tipo: d.tipo,
    mime: d.mime_type,
    tamanho: d.tamanho_bytes,
  }))
  return NextResponse.json({ documentos })
}
