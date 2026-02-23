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

    const { data: usuarioLogado } = await supabase
      .from('users')
      .select('id, tenant_id, nome, oab_numero, oab_estado, telefone_profissional, email_profissional, endereco_profissional, cidade_profissional, estado_profissional, cep_profissional')
      .eq('auth_user_id', user.id)
      .single()
    if (!usuarioLogado) return NextResponse.json({ error: 'Usuário não encontrado' }, { status: 404 })

    // Busca o contrato com dados do cliente e atendimento
    const { data: contrato } = await supabase
      .from('contratos_honorarios')
      .select('*, clientes(nome, cpf, telefone, email, endereco, bairro, cidade, estado, cep), atendimentos(transcricao_editada, transcricao_raw, pedidos_especificos, area)')
      .eq('id', contratoId)
      .eq('tenant_id', usuarioLogado.tenant_id)
      .single()

    if (!contrato) return NextResponse.json({ error: 'Contrato não encontrado' }, { status: 404 })

    const cliente     = contrato.clientes as { nome?: string; cpf?: string; telefone?: string; email?: string; endereco?: string; bairro?: string; cidade?: string; estado?: string; cep?: string } | null
    const atendimento = contrato.atendimentos as { transcricao_editada?: string; transcricao_raw?: string; pedidos_especificos?: string; area?: string } | null

    // Determina o advogado para o contrato:
    // 1. Usuário logado (se tem OAB)
    // 2. Advogado principal do tenant
    let dadosAdvogado = usuarioLogado.oab_numero ? usuarioLogado : null

    if (!dadosAdvogado) {
      const { data: principal } = await supabase
        .from('users')
        .select('nome, oab_numero, oab_estado, telefone_profissional, email_profissional, endereco_profissional, cidade_profissional, estado_profissional, cep_profissional')
        .eq('tenant_id', usuarioLogado.tenant_id)
        .eq('is_advogado_principal', true)
        .eq('status', 'ativo')
        .single()
      dadosAdvogado = principal
    }

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
        telefone: cliente?.telefone,
        email:    cliente?.email,
        endereco: cliente?.endereco,
        bairro:   cliente?.bairro,
        cidade:   cliente?.cidade,
        estado:   cliente?.estado,
        cep:      cliente?.cep,
      },
      dadosAdvogado: dadosAdvogado ? {
        nome:      dadosAdvogado.nome,
        oab_numero: dadosAdvogado.oab_numero ?? undefined,
        oab_estado: dadosAdvogado.oab_estado ?? undefined,
        telefone:  dadosAdvogado.telefone_profissional ?? undefined,
        email:     dadosAdvogado.email_profissional    ?? undefined,
        endereco:  dadosAdvogado.endereco_profissional ?? undefined,
        cidade:    dadosAdvogado.cidade_profissional   ?? undefined,
        estado:    dadosAdvogado.estado_profissional   ?? undefined,
        cep:       dadosAdvogado.cep_profissional      ?? undefined,
      } : undefined,
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
