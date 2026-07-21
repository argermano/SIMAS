import { NextRequest, NextResponse } from 'next/server'
import { getAuthContext } from '@/lib/auth'
import { jsonError } from '@/lib/api'
import { markdownToDocx } from '@/lib/export/docx-generator'
import { aplicarTimbrado } from '@/lib/export/aplicar-timbrado'
import { carregarEstiloTenant } from '@/lib/format/estilo-documento'

// POST /api/exportar-documento — gerar DOCX a partir de markdown raw (sem pecaId)
export async function POST(req: NextRequest) {
  try {
    const { conteudo, titulo, contrato, compacto } = await req.json() as {
      conteudo: string; titulo?: string; contrato?: boolean; compacto?: boolean
    }

    if (!conteudo?.trim()) {
      return jsonError('Conteúdo obrigatório', 400)
    }

    const auth = await getAuthContext()
    if (!auth.ok) return auth.response
    const { supabase, usuario } = auth

    const estilo = await carregarEstiloTenant(supabase, usuario.tenant_id)
    let buffer = await markdownToDocx(conteudo, { titulo, estilo, contrato, compacto })

    // Aplica o papel timbrado do escritório, se houver (preserva cabeçalho/marca d'água/rodapé)
    const { data: timbrado } = await supabase.storage
      .from('documentos')
      .download(`${usuario.tenant_id}/timbrado/timbrado.docx`)
    if (timbrado) {
      try {
        buffer = aplicarTimbrado(Buffer.from(await timbrado.arrayBuffer()), buffer)
      } catch (err) {
        console.error('[exportar-documento] falha ao aplicar timbrado:', err instanceof Error ? err.message : err)
      }
    }

    // titulo vem do corpo da requisição: sanitizar antes do header p/ evitar
    // injeção no Content-Disposition (aspas/quebras de linha/controle quebram o
    // header). filename= leva só ASCII allowlisted; filename* (RFC 5987) preserva
    // o nome UTF-8 completo via encodeURIComponent.
    const tituloLimpo = (titulo ?? '').replace(/[\u0000-\u001f\u007f]/g, '').trim() || 'documento'
    const fileNameAscii =
      tituloLimpo
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-zA-Z0-9\s_-]/g, '')
        .trim()
        .replace(/\s+/g, '_') || 'documento'
    const fileNameUtf8 = encodeURIComponent(`${tituloLimpo}.docx`)

    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'Content-Disposition': `attachment; filename="${fileNameAscii}.docx"; filename*=UTF-8''${fileNameUtf8}`,
      },
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Erro desconhecido'
    return jsonError(message, 500)
  }
}
