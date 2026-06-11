import { NextRequest, NextResponse } from 'next/server'
import { getAuthContext } from '@/lib/auth'
import { jsonError } from '@/lib/api'
import { markdownToDocx } from '@/lib/export/docx-generator'
import { aplicarTimbrado } from '@/lib/export/aplicar-timbrado'
import { resolverEstiloEfetivo } from '@/lib/format/estilo-documento'
import { TIPOS_PECA } from '@/lib/constants/tipos-peca'

// POST /api/exportar — gerar e retornar DOCX
export async function POST(req: NextRequest) {
  try {
    const { pecaId, formato } = await req.json()
    if (!pecaId) return jsonError('pecaId é obrigatório', 400)
    if (formato && formato !== 'docx') {
      return jsonError('Apenas formato docx é suportado no momento', 400)
    }

    const auth = await getAuthContext()
    if (!auth.ok) return auth.response
    const { supabase, usuario } = auth

    const { data: peca } = await supabase
      .from('pecas')
      .select('*')
      .eq('id', pecaId)
      .eq('tenant_id', usuario.tenant_id)
      .single()
    if (!peca) return jsonError('Peça não encontrada', 404)
    if (!peca.conteudo_markdown) return jsonError('Peça sem conteúdo', 400)

    const tipoPecaConfig = TIPOS_PECA[peca.tipo]
    const titulo = tipoPecaConfig?.nome ?? peca.tipo

    const estilo = await resolverEstiloEfetivo(supabase, usuario.tenant_id, { tipo: 'peca', subtipo: peca.tipo })
    let buffer = await markdownToDocx(peca.conteudo_markdown, {
      titulo,
      area: peca.area,
      estilo,
    })

    // Se o escritório cadastrou um papel timbrado, gera a peça dentro dele
    // (preservando cabeçalho/logo, marca d'água e rodapé). Falha não bloqueia o export.
    const { data: timbrado } = await supabase.storage
      .from('documentos')
      .download(`${usuario.tenant_id}/timbrado/timbrado.docx`)
    if (timbrado) {
      try {
        buffer = aplicarTimbrado(Buffer.from(await timbrado.arrayBuffer()), buffer)
      } catch (err) {
        console.error('[exportar] falha ao aplicar timbrado:', err instanceof Error ? err.message : err)
      }
    }

    // Salvar registro de exportação
    await supabase.from('exportacoes').insert({
      peca_id: pecaId,
      tenant_id: usuario.tenant_id,
      formato: 'docx',
      file_url: `export_${pecaId}_v${peca.versao}.docx`,
      versao_snapshot: peca.versao,
      exported_by: usuario.id,
    })

    // Atualizar status da peça
    await supabase.from('pecas').update({ status: 'exportada' }).eq('id', pecaId)

    const fileName = `${titulo.replace(/\s+/g, '_')}_v${peca.versao}.docx`

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
