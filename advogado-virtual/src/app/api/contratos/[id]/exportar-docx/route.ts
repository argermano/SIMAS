import { NextRequest, NextResponse } from 'next/server'
import { getAuthContext, requireRole } from '@/lib/auth'
import { jsonError } from '@/lib/api'
import { markdownToDocx } from '@/lib/export/docx-generator'
import { carregarEstiloTenant } from '@/lib/format/estilo-documento'

// POST /api/contratos/[id]/exportar-docx
// Usa o gerador DOCX único (markdownToDocx) com o estilo do escritório.
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const auth = await getAuthContext()
  if (!auth.ok) return auth.response
  const { supabase, usuario } = auth

  const semPermissao = requireRole(usuario, ['admin', 'advogado'])
  if (semPermissao) return semPermissao

  const { data: contrato } = await supabase
    .from('contratos_honorarios')
    .select('titulo, conteudo_markdown, status')
    .eq('id', id)
    .eq('tenant_id', usuario.tenant_id)
    .single()

  if (!contrato) return jsonError('Contrato não encontrado', 404)
  if (!contrato.conteudo_markdown?.trim()) {
    return jsonError('Contrato sem conteúdo', 400)
  }

  await supabase
    .from('contratos_honorarios')
    .update({ status: 'exportado' })
    .eq('id', id)

  const estilo = await carregarEstiloTenant(supabase, usuario.tenant_id)
  const buffer = await markdownToDocx(contrato.conteudo_markdown, {
    titulo: contrato.titulo ?? 'Contrato',
    estilo,
  })

  const fileName = (contrato.titulo ?? 'contrato').replace(/[^a-zA-Z0-9\s_-]/g, '').trim()

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'Content-Disposition': `attachment; filename="${fileName}.docx"`,
    },
  })
}
