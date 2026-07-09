import { NextResponse } from 'next/server'
import { getAuthContext } from '@/lib/auth'
import { jsonError } from '@/lib/api'
import { extrairTextoPlano } from '@/lib/processos/djen'

// ─────────────────────────────────────────────────────────────
// GET /api/publicacoes/[id] — detalhe de uma publicação do tenant (Lote 2)
// Deriva `textoPlano` do HTML bruto (`texto`) e expõe apenas `meta.link` — NUNCA
// devolve o `meta` completo nem o `texto` cru (HTML dos tribunais). `destinatarios`
// (coluna própria) segue no payload. 404 se a linha não for do tenant.
// ─────────────────────────────────────────────────────────────

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const auth = await getAuthContext()
  if (!auth.ok) return auth.response
  const { supabase, usuario } = auth

  const { data: pub } = await supabase
    .from('publicacoes')
    .select('*')
    .eq('id', id)
    .eq('tenant_id', usuario.tenant_id) // defesa em profundidade (RLS já isola)
    .single()

  if (!pub) return jsonError('Publicação não encontrada.', 404)

  // Remove `texto` (HTML cru) e `meta` (item bruto) do payload; entrega derivados.
  const { texto, meta, ...rest } = pub as {
    texto: string | null
    meta: { link?: string | null } | null
  } & Record<string, unknown>
  const link = meta?.link ?? null

  return NextResponse.json({
    publicacao: {
      ...rest,
      textoPlano: extrairTextoPlano(texto),
      link,
    },
  })
}
