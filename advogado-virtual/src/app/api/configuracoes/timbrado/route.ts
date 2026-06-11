import { NextRequest, NextResponse } from 'next/server'
import { getAuthContext, requireRole } from '@/lib/auth'
import { jsonError } from '@/lib/api'

const MAX_BYTES = 20 * 1024 * 1024
const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'

function caminho(tenantId: string): string {
  return `${tenantId}/timbrado/timbrado.docx`
}

// GET /api/configuracoes/timbrado — informa se há timbrado cadastrado
export async function GET() {
  const auth = await getAuthContext()
  if (!auth.ok) return auth.response
  const { supabase, usuario } = auth

  const { data } = await supabase.storage.from('documentos').list(`${usuario.tenant_id}/timbrado`)
  const existe = !!data?.some((f) => f.name === 'timbrado.docx')
  return NextResponse.json({ existe })
}

// POST /api/configuracoes/timbrado — envia o .docx do papel timbrado (admin)
export async function POST(req: NextRequest) {
  const auth = await getAuthContext()
  if (!auth.ok) return auth.response
  const { supabase, usuario } = auth

  const semPermissao = requireRole(usuario, ['admin'])
  if (semPermissao) return semPermissao

  const form = await req.formData().catch(() => null)
  const file = form?.get('timbrado')
  if (!(file instanceof File)) return jsonError('Arquivo é obrigatório', 400)
  if (!/\.docx$/i.test(file.name)) return jsonError('Envie o papel timbrado em formato .docx (Word)', 400)
  if (file.size > MAX_BYTES) return jsonError('Arquivo muito grande (máx. 20 MB)', 413)

  const buffer = Buffer.from(await file.arrayBuffer())
  const { error } = await supabase.storage
    .from('documentos')
    .upload(caminho(usuario.tenant_id), buffer, { contentType: DOCX_MIME, upsert: true })

  if (error) return jsonError('Falha ao salvar o papel timbrado', 500)
  return NextResponse.json({ ok: true })
}

// DELETE /api/configuracoes/timbrado — remove o timbrado (admin)
export async function DELETE() {
  const auth = await getAuthContext()
  if (!auth.ok) return auth.response
  const { supabase, usuario } = auth

  const semPermissao = requireRole(usuario, ['admin'])
  if (semPermissao) return semPermissao

  await supabase.storage.from('documentos').remove([caminho(usuario.tenant_id)])
  return NextResponse.json({ ok: true })
}
