import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getAnthropicClient, DEFAULT_MODEL, DEFAULT_MAX_TOKENS } from '@/lib/anthropic/client'
import { SYSTEM_PROCURACAO, buildPromptProcuracao } from '@/lib/prompts/documentos/procuracao'
import { SYSTEM_DECLARACAO, buildPromptDeclaracao } from '@/lib/prompts/documentos/declaracao-hipossuficiencia'

type TipoDoc = 'procuracao' | 'declaracao_hipossuficiencia'

function substituir(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => vars[key] ?? `[PREENCHER: ${key}]`)
}

function dataExtenso(): string {
  return new Date().toLocaleDateString('pt-BR', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'America/Sao_Paulo',
  })
}

// POST /api/ia/gerar-documento
// body: { tipo, clienteId, atendimentoId?, camposExtras? }
// Se template existe → substitui variáveis → retorna conteudo (sem IA)
// Se não existe   → gera com IA → salva template → retorna conteudo
export async function POST(req: NextRequest) {
  try {
    const { tipo, clienteId, camposExtras } = await req.json() as {
      tipo: TipoDoc
      clienteId: string
      atendimentoId?: string | null
      camposExtras?: Record<string, string>
    }

    if (!tipo || !clienteId) {
      return NextResponse.json({ error: 'tipo e clienteId são obrigatórios' }, { status: 400 })
    }

    if (!['procuracao', 'declaracao_hipossuficiencia'].includes(tipo)) {
      return NextResponse.json({ error: 'Tipo inválido' }, { status: 400 })
    }

    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })

    const { data: usuario } = await supabase
      .from('users')
      .select('id, nome, tenant_id')
      .eq('auth_user_id', user.id)
      .single()

    if (!usuario) return NextResponse.json({ error: 'Usuário não encontrado' }, { status: 404 })

    // Buscar dados do cliente
    const { data: cliente } = await supabase
      .from('clientes')
      .select('nome, cpf, endereco, cidade, estado')
      .eq('id', clienteId)
      .eq('tenant_id', usuario.tenant_id)
      .single()

    if (!cliente) return NextResponse.json({ error: 'Cliente não encontrado' }, { status: 404 })

    // Verificar se já existe template salvo
    const { data: templateExistente } = await supabase
      .from('templates_documentos')
      .select('id, conteudo_markdown')
      .eq('tenant_id', usuario.tenant_id)
      .eq('tipo', tipo)
      .single()

    const vars: Record<string, string> = {
      nome_cliente:     cliente.nome     ?? '',
      cpf_cliente:      cliente.cpf      ?? '',
      endereco_cliente: cliente.endereco ?? '',
      cidade_cliente:   cliente.cidade   ?? '',
      estado_cliente:   cliente.estado   ?? '',
      data_extenso:     dataExtenso(),
      nome_advogado:    usuario.nome     ?? '',
      ...camposExtras,
    }

    // Template existente → substituir variáveis e retornar (sem IA)
    if (templateExistente) {
      const conteudo = substituir(templateExistente.conteudo_markdown, vars)
      return NextResponse.json({ conteudo, templateExistia: true })
    }

    // Sem template → gerar com IA
    const anthropic = getAnthropicClient()

    let system: string
    let prompt: string

    if (tipo === 'procuracao') {
      system = SYSTEM_PROCURACAO
      prompt = buildPromptProcuracao({
        cliente: {
          nome:     cliente.nome,
          cpf:      cliente.cpf,
          endereco: cliente.endereco,
          cidade:   cliente.cidade,
          estado:   cliente.estado,
        },
        advogadoNome: usuario.nome ?? 'Advogado',
        objeto: camposExtras?.objeto,
      })
    } else {
      system = SYSTEM_DECLARACAO
      prompt = buildPromptDeclaracao({
        cliente: {
          nome:     cliente.nome,
          cpf:      cliente.cpf,
          endereco: cliente.endereco,
          cidade:   cliente.cidade,
          estado:   cliente.estado,
        },
      })
    }

    const message = await anthropic.messages.create({
      model:      DEFAULT_MODEL,
      max_tokens: DEFAULT_MAX_TOKENS,
      system,
      messages: [{ role: 'user', content: prompt }],
    })

    const templateGerado = message.content
      .filter(b => b.type === 'text')
      .map(b => b.text)
      .join('')

    // Salvar template para uso futuro (UPSERT)
    await supabase
      .from('templates_documentos')
      .upsert(
        {
          tenant_id:         usuario.tenant_id,
          tipo,
          conteudo_markdown: templateGerado,
          criado_por:        usuario.id,
          updated_at:        new Date().toISOString(),
        },
        { onConflict: 'tenant_id,tipo' }
      )

    // Substituir variáveis no template gerado e retornar
    const conteudo = substituir(templateGerado, vars)

    return NextResponse.json({ conteudo, templateExistia: false })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Erro desconhecido'
    console.error('[gerar-documento]', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
