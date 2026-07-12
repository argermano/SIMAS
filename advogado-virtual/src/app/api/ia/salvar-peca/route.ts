import { NextRequest, NextResponse } from 'next/server'
import { getAuthContext } from '@/lib/auth'
import { jsonError } from '@/lib/api'
import { calcularTaxaEdicao } from '@/lib/telemetria/taxa-edicao'
import { encolhimentoPerigoso } from '@/lib/ia/pecas/guarda-encolhimento'

export const maxDuration = 120

// POST /api/ia/salvar-peca — salva conteúdo editado da peça
export async function POST(req: NextRequest) {
  try {
    const { pecaId, conteudo, semVersao, forcar } = await req.json()

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

    // Guarda anti-encolhimento (camada C): salvar um conteúdo bem menor que o
    // rascunho já salvo exige confirmação explícita (forcar) — protege o texto
    // íntegro do servidor de ser sobrescrito por um parcial pós-queda. Só no
    // save versionado; o autosave (semVersao) reflete a edição ao vivo.
    if (!forcar && encolhimentoPerigoso(pecaAtual.conteudo_markdown, conteudo)) {
      return jsonError('Conteúdo menor que o rascunho salvo', 409, {
        code: 'CONTEUDO_MENOR',
        atual: pecaAtual.conteudo_markdown?.length ?? 0,
        novo: conteudo.length,
      })
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

    // Telemetria de edição (B6-mínimo): compara o salvo com a geração original
    // (1ª versão histórica). Best-effort — nunca derruba o save.
    try {
      const { data: base } = await supabase
        .from('pecas_versoes')
        .select('conteudo_markdown')
        .eq('peca_id', pecaId)
        .order('versao', { ascending: true })
        .limit(1)
        .single()
      if (base?.conteudo_markdown) {
        await supabase
          .from('pecas')
          .update({ taxa_edicao: calcularTaxaEdicao(base.conteudo_markdown, conteudo) })
          .eq('id', pecaId)
          .eq('tenant_id', usuario.tenant_id)
      }
    } catch {
      // telemetria não pode quebrar o salvamento
    }

    return NextResponse.json({ ok: true, versao: (pecaAtual.versao ?? 1) + 1 })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Erro desconhecido'
    return jsonError(message, 500)
  }
}
