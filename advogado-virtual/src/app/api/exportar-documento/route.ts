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

    const fileName = `${(titulo ?? 'documento').replace(/\s+/g, '_')}.docx`

    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'Content-Disposition': `attachment; filename="${fileName}"`,
      },
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Erro desconhecido'
    return jsonError(message, 500)
  }
}
