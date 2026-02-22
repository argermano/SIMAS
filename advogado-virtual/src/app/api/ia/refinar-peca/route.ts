import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { completionJSON, DEFAULT_MODEL } from '@/lib/anthropic/client'
import { logUsage } from '@/lib/anthropic/usage'
import { buildPromptRefinar, SYSTEM_REFINAR } from '@/lib/prompts/refinamento/refinar-com-documentos'

// POST /api/ia/refinar-peca — refinar peça com novos documentos
export async function POST(req: NextRequest) {
  const start = Date.now()

  try {
    const { pecaId } = await req.json()
    if (!pecaId) return NextResponse.json({ error: 'pecaId é obrigatório' }, { status: 400 })

    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })

    const { data: usuario } = await supabase
      .from('users')
      .select('id, tenant_id')
      .eq('auth_user_id', user.id)
      .single()
    if (!usuario) return NextResponse.json({ error: 'Usuário não encontrado' }, { status: 404 })

    // Buscar peça
    const { data: peca } = await supabase
      .from('pecas')
      .select('*')
      .eq('id', pecaId)
      .eq('tenant_id', usuario.tenant_id)
      .single()
    if (!peca) return NextResponse.json({ error: 'Peça não encontrada' }, { status: 404 })

    // Buscar documentos do atendimento
    const { data: documentos } = await supabase
      .from('documentos')
      .select('tipo, texto_extraido, file_name')
      .eq('atendimento_id', peca.atendimento_id)

    if (!documentos || documentos.length === 0) {
      return NextResponse.json({ error: 'Nenhum documento encontrado para refinar' }, { status: 400 })
    }

    const prompt = buildPromptRefinar({
      peca_atual: peca.conteudo_markdown ?? '',
      documentos_novos: documentos.map(d => ({
        tipo: d.tipo ?? 'outro',
        texto_extraido: d.texto_extraido ?? '',
        file_name: d.file_name ?? 'documento',
      })),
    })

    const { result, usage } = await completionJSON<{
      peca_refinada: string
      mudancas: Array<{ tipo: string; descricao: string; documento_fonte: string }>
      divergencias: Array<{ fato_transcricao: string; fato_documento: string; recomendacao: string }>
    }>({ system: SYSTEM_REFINAR, prompt })

    // Salvar versão antiga
    await supabase.from('pecas_versoes').insert({
      peca_id: pecaId,
      versao: peca.versao,
      conteudo_markdown: peca.conteudo_markdown,
      alterado_por: usuario.id,
    })

    // Atualizar peça
    await supabase
      .from('pecas')
      .update({
        conteudo_markdown: result.peca_refinada,
        versao: peca.versao + 1,
      })
      .eq('id', pecaId)

    // Log
    await logUsage({
      tenantId: usuario.tenant_id,
      userId: usuario.id,
      endpoint: 'refinar_peca',
      modelo: DEFAULT_MODEL,
      tokensInput: usage.input,
      tokensOutput: usage.output,
      latenciaMs: Date.now() - start,
    })

    return NextResponse.json({
      versao: peca.versao + 1,
      mudancas: result.mudancas,
      divergencias: result.divergencias,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Erro desconhecido'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
