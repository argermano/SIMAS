import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { streamCompletion } from '@/lib/anthropic/client'
import { buildPromptContratoHonorarios, SYSTEM_CONTRATO_HONORARIOS } from '@/lib/prompts/contratos/honorarios'

// POST /api/ia/gerar-contrato — geração de contrato de honorários com streaming SSE
export async function POST(req: NextRequest) {
  try {
    const {
      contratoId,
      instrucoes,
      modeloTexto,
    } = await req.json() as {
      contratoId:   string
      instrucoes?:  string
      modeloTexto?: string
    }

    if (!contratoId) {
      return NextResponse.json({ error: 'contratoId é obrigatório' }, { status: 400 })
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

    // Busca o contrato com dados do cliente e atendimento
    const { data: contrato } = await supabase
      .from('contratos_honorarios')
      .select('*, clientes(nome, cpf, endereco, cidade, estado), atendimentos(transcricao_editada, transcricao_raw, pedidos_especificos, area)')
      .eq('id', contratoId)
      .eq('tenant_id', usuario.tenant_id)
      .single()

    if (!contrato) return NextResponse.json({ error: 'Contrato não encontrado' }, { status: 404 })

    const cliente     = contrato.clientes as { nome?: string; cpf?: string; endereco?: string; cidade?: string; estado?: string } | null
    const atendimento = contrato.atendimentos as { transcricao_editada?: string; transcricao_raw?: string; pedidos_especificos?: string; area?: string } | null

    // Monta o resumo do caso a partir do atendimento vinculado
    const resumoCaso = atendimento
      ? (atendimento.transcricao_editada ?? atendimento.transcricao_raw ?? '').substring(0, 1000)
      : ''

    const prompt = buildPromptContratoHonorarios({
      dadosContrato: {
        titulo:           contrato.titulo,
        area:             contrato.area ?? atendimento?.area,
        valor_fixo:       contrato.valor_fixo,
        percentual_exito: contrato.percentual_exito,
        forma_pagamento:  contrato.forma_pagamento,
      },
      dadosCliente: {
        nome:     cliente?.nome,
        cpf:      cliente?.cpf,
        endereco: cliente?.endereco,
        cidade:   cliente?.cidade,
        estado:   cliente?.estado,
      },
      resumoCaso,
      modeloAdvogado: modeloTexto,
      instrucoes,
    })

    const { stream } = await streamCompletion({
      system: SYSTEM_CONTRATO_HONORARIOS,
      prompt,
      maxTokens: 6000,
    })

    return new Response(stream, {
      headers: {
        'Content-Type':                  'text/event-stream',
        'Cache-Control':                 'no-cache',
        'Connection':                    'keep-alive',
        'X-Contrato-Id':                 contratoId,
        'Access-Control-Expose-Headers': 'X-Contrato-Id',
      },
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Erro desconhecido'
    console.error('[gerar-contrato]', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
