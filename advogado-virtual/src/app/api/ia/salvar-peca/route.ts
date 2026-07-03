import { NextRequest, NextResponse } from 'next/server'
import { getAuthContext } from '@/lib/auth'
import { jsonError } from '@/lib/api'

export const maxDuration = 120

// POST /api/ia/salvar-peca — salva conteúdo editado da peça
export async function POST(req: NextRequest) {
  try {
    const { pecaId, conteudo, semVersao } = await req.json()

    if (!pecaId || conteudo === undefined) {
      return jsonError('pecaId e conteudo são obrigatórios', 400)
    }

    const auth = await getAuthContext()
    if (!auth.ok) return auth.response
    const { supabase, usuario } = auth

    // Busca a peça atual para criar versão histórica
    const { data: pecaAtual } = await supabase
      .from('pecas')
      .select('id, versao, conteudo_markdown, tenant_id')
      .eq('id', pecaId)
      .eq('tenant_id', usuario.tenant_id)
      .single()

    if (!pecaAtual) {
      return jsonError('Peça não encontrada', 404)
    }

    // Autosave (semVersao) só atualiza o conteúdo — não cria versão histórica
    // nem incrementa a versão (senão o autosave a cada poucos segundos geraria
    // dezenas de versões). O save manual e as gerações/correções versionam.
    if (semVersao) {
      const { error } = await supabase
        .from('pecas')
        .update({ conteudo_markdown: conteudo, updated_at: new Date().toISOString() })
        .eq('id', pecaId)
        .eq('tenant_id', usuario.tenant_id)
      if (error) return jsonError('Erro ao salvar peça', 500)
      return NextResponse.json({ ok: true, versao: pecaAtual.versao ?? 1 })
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
      return jsonError('Erro ao salvar peça', 500)
    }

    return NextResponse.json({ ok: true, versao: (pecaAtual.versao ?? 1) + 1 })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Erro desconhecido'
    return jsonError(message, 500)
  }
}
