import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

// POST /api/ia/salvar-peca — salva conteúdo editado da peça
export async function POST(req: NextRequest) {
  try {
    const { pecaId, conteudo } = await req.json()

    if (!pecaId || conteudo === undefined) {
      return NextResponse.json({ error: 'pecaId e conteudo são obrigatórios' }, { status: 400 })
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

    // Busca a peça atual para criar versão histórica
    const { data: pecaAtual } = await supabase
      .from('pecas')
      .select('id, versao, conteudo_markdown, tenant_id')
      .eq('id', pecaId)
      .eq('tenant_id', usuario.tenant_id)
      .single()

    if (!pecaAtual) {
      return NextResponse.json({ error: 'Peça não encontrada' }, { status: 404 })
    }

    // Salva versão histórica antes de atualizar
    if (pecaAtual.conteudo_markdown) {
      await supabase.from('pecas_versoes').insert({
        peca_id: pecaId,
        versao: pecaAtual.versao,
        conteudo_markdown: pecaAtual.conteudo_markdown,
        alterado_por: usuario.id,
      })
    }

    // Atualiza a peça com novo conteúdo e incrementa versão
    const { error } = await supabase
      .from('pecas')
      .update({
        conteudo_markdown: conteudo,
        versao: (pecaAtual.versao ?? 1) + 1,
        updated_at: new Date().toISOString(),
      })
      .eq('id', pecaId)
      .eq('tenant_id', usuario.tenant_id)

    if (error) {
      return NextResponse.json({ error: 'Erro ao salvar peça' }, { status: 500 })
    }

    return NextResponse.json({ ok: true, versao: (pecaAtual.versao ?? 1) + 1 })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Erro desconhecido'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
