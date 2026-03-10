import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { streamCompletion, DEFAULT_MODEL } from '@/lib/anthropic/client'
import { logUsage } from '@/lib/anthropic/usage'

const LABELS_AREA: Record<string, string> = {
  previdenciario: 'Previdenciário',
  trabalhista:    'Trabalhista',
  civel:          'Cível',
  criminal:       'Criminal',
  tributario:     'Tributário',
  empresarial:    'Empresarial',
}

const SYSTEM_REFINAMENTO = `Você é um advogado brasileiro extremamente experiente e minucioso, especialista em revisão e refinamento de peças processuais. Seu trabalho é receber uma peça existente, analisá-la junto com os documentos do caso e as instruções do advogado, e produzir uma versão refinada e melhorada.

REGRAS:
- Produza a peça completa em Markdown, pronta para uso
- Mantenha a estrutura formal da peça (endereçamento, qualificação, fatos, fundamentação, pedidos)
- Preserve dados corretos da peça original (nomes, CPFs, datas, etc.)
- Corrija erros factuais quando os documentos contradizem a peça
- Fortaleça a argumentação jurídica com base nos documentos
- Siga as instruções específicas do advogado
- Use formatação Markdown (##, **, etc.) para estruturar a peça
- Campos que não puderem ser determinados devem usar [PREENCHER]
- NÃO inclua comentários, explicações ou metadados — apenas a peça refinada`

// POST /api/ia/refinamento-peca — gera peça refinada com streaming
export async function POST(req: NextRequest) {
  const start = Date.now()

  try {
    const body = await req.json()
    const { atendimentoId, area, pecaOriginal, instrucoes } = body as {
      atendimentoId: string
      area: string
      pecaOriginal: string
      instrucoes?: string
    }

    if (!atendimentoId || !area || !pecaOriginal) {
      return NextResponse.json({ error: 'atendimentoId, area e pecaOriginal são obrigatórios' }, { status: 400 })
    }

    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })

    const { data: usuario } = await supabase
      .from('users')
      .select('id, tenant_id, role')
      .eq('auth_user_id', user.id)
      .single()
    if (!usuario) return NextResponse.json({ error: 'Usuário não encontrado' }, { status: 404 })

    const statusInicial = usuario.role === 'colaborador' ? 'aguardando_revisao' : 'rascunho'

    // Buscar atendimento + documentos + cliente
    const { data: atendimento } = await supabase
      .from('atendimentos')
      .select('*, documentos(tipo, texto_extraido, file_name), clientes(nome)')
      .eq('id', atendimentoId)
      .eq('tenant_id', usuario.tenant_id)
      .single()
    if (!atendimento) return NextResponse.json({ error: 'Atendimento não encontrado' }, { status: 404 })

    const documentos = (atendimento.documentos ?? [])
      .filter((d: Record<string, unknown>) => d.texto_extraido && (d.texto_extraido as string).trim().length > 10)
      .map((d: Record<string, unknown>) => ({
        tipo: d.tipo as string,
        texto_extraido: d.texto_extraido as string,
        file_name: d.file_name as string,
      }))

    const nomeArea = LABELS_AREA[area] ?? area

    // Build prompt
    const partes: string[] = [
      `Você é um advogado especialista em Direito ${nomeArea}. Refine a peça processual abaixo.`,
      '',
      '## PEÇA ORIGINAL (a ser refinada)',
      pecaOriginal,
    ]

    if (documentos.length > 0) {
      partes.push('', '## DOCUMENTOS DO CASO')
      for (const doc of documentos) {
        partes.push(`### ${doc.file_name} (${doc.tipo})`, doc.texto_extraido, '')
      }
      partes.push('Use os documentos acima para corrigir dados, fortalecer argumentação e fundamentar melhor os pedidos.')
    }

    if (instrucoes?.trim()) {
      partes.push('', '## INSTRUÇÕES DO ADVOGADO (PRIORIDADE MÁXIMA)', instrucoes.trim())
    }

    partes.push(
      '',
      '## TAREFA',
      `Produza a peça refinada COMPLETA em Markdown, considerando a área de ${nomeArea}.`,
      'Aplique as instruções do advogado, cruze com os documentos e melhore a argumentação.',
      'Responda APENAS com o Markdown da peça — sem explicações, sem comentários.',
    )

    const prompt = partes.join('\n')

    // Criar peça no banco
    const { data: peca } = await supabase
      .from('pecas')
      .insert({
        atendimento_id: atendimentoId,
        tenant_id: usuario.tenant_id,
        tipo: 'refinamento',
        area,
        status: statusInicial,
        created_by: usuario.id,
      })
      .select('id')
      .single()

    const { stream, getUsage } = await streamCompletion({
      system: SYSTEM_REFINAMENTO,
      prompt,
      maxTokens: 32768,
    })

    // Log assíncrono
    getUsage().then(async (usage) => {
      await logUsage({
        tenantId: usuario.tenant_id,
        userId: usuario.id,
        endpoint: 'refinamento_peca',
        modelo: DEFAULT_MODEL,
        tokensInput: usage.input,
        tokensOutput: usage.output,
        latenciaMs: Date.now() - start,
      })
    }).catch(() => {})

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
        'X-Peca-Id': peca?.id ?? '',
        'Access-Control-Expose-Headers': 'X-Peca-Id',
      },
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Erro desconhecido'
    console.error('[refinamento-peca] Erro:', message, err)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
