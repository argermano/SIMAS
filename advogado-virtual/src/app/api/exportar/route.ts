import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { markdownToDocx } from '@/lib/export/docx-generator'
import { TIPOS_PECA } from '@/lib/constants/tipos-peca'

// POST /api/exportar — gerar e retornar DOCX
export async function POST(req: NextRequest) {
  try {
    const { pecaId, formato } = await req.json()
    if (!pecaId) return NextResponse.json({ error: 'pecaId é obrigatório' }, { status: 400 })
    if (formato && formato !== 'docx') {
      return NextResponse.json({ error: 'Apenas formato docx é suportado no momento' }, { status: 400 })
    }

    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })

    const { data: usuario } = await supabase
      .from('users')
      .select('id, tenant_id')
      .eq('auth_user_id', user.id)
      .single()
    if (!usuario) return NextResponse.json({ error: 'Usuário não encontrado' }, { status: 404 })

    const { data: peca } = await supabase
      .from('pecas')
      .select('*')
      .eq('id', pecaId)
      .eq('tenant_id', usuario.tenant_id)
      .single()
    if (!peca) return NextResponse.json({ error: 'Peça não encontrada' }, { status: 404 })
    if (!peca.conteudo_markdown) return NextResponse.json({ error: 'Peça sem conteúdo' }, { status: 400 })

    const tipoPecaConfig = TIPOS_PECA[peca.tipo]
    const titulo = tipoPecaConfig?.nome ?? peca.tipo

    const buffer = await markdownToDocx(peca.conteudo_markdown, {
      titulo,
      area: peca.area,
    })

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
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
