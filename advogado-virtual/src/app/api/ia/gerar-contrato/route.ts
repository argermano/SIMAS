import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { streamCompletion } from '@/lib/anthropic/client'
import {
  buildPromptContratoHonorarios,
  SYSTEM_CONTRATO_HONORARIOS,
  SYSTEM_PREENCHER_MODELO,
} from '@/lib/prompts/contratos/honorarios'

const CAMPOS_TENANT_PROFISSIONAL = 'nome_responsavel, oab_numero, oab_estado, cpf_responsavel, rg_responsavel, orgao_expedidor, estado_civil, nacionalidade, telefone, email_profissional, endereco, bairro, cidade, estado, cep'

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

    console.log('[gerar-contrato] contratoId:', contratoId, '| modeloTexto length:', modeloTexto?.length ?? 0, '| tem modelo:', !!modeloTexto)

    if (!contratoId) {
      return NextResponse.json({ error: 'contratoId é obrigatório' }, { status: 400 })
    }

    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })

    const { data: usuarioLogado } = await supabase
      .from('users')
      .select('id, tenant_id')
      .eq('auth_user_id', user.id)
      .single()
    if (!usuarioLogado) return NextResponse.json({ error: 'Usuário não encontrado' }, { status: 404 })

    // Buscar dados profissionais do escritório (tenant)
    const { data: tenant } = await supabase
      .from('tenants')
      .select(CAMPOS_TENANT_PROFISSIONAL)
      .eq('id', usuarioLogado.tenant_id)
      .single()

    // Busca o contrato com dados do cliente e atendimento
    const { data: contrato } = await supabase
      .from('contratos_honorarios')
      .select('*, clientes(nome, cpf, rg, orgao_expedidor, estado_civil, nacionalidade, profissao, telefone, email, endereco, bairro, cidade, estado, cep), atendimentos(transcricao_editada, transcricao_raw, pedidos_especificos, area)')
      .eq('id', contratoId)
      .eq('tenant_id', usuarioLogado.tenant_id)
      .single()

    if (!contrato) return NextResponse.json({ error: 'Contrato não encontrado' }, { status: 404 })

    const cliente = contrato.clientes as {
      nome?: string; cpf?: string; rg?: string; orgao_expedidor?: string
      estado_civil?: string; nacionalidade?: string; profissao?: string
      telefone?: string; email?: string; endereco?: string; bairro?: string
      cidade?: string; estado?: string; cep?: string
    } | null
    const atendimento = contrato.atendimentos as { transcricao_editada?: string; transcricao_raw?: string; pedidos_especificos?: string; area?: string } | null

    const resumoCaso = atendimento
      ? (atendimento.transcricao_editada ?? atendimento.transcricao_raw ?? '').substring(0, 1000)
      : ''

    const dadosSubstituicao = {
      cliente: {
        nome: cliente?.nome, cpf: cliente?.cpf, rg: cliente?.rg,
        orgao_expedidor: cliente?.orgao_expedidor, estado_civil: cliente?.estado_civil,
        nacionalidade: cliente?.nacionalidade, profissao: cliente?.profissao,
        telefone: cliente?.telefone, email: cliente?.email,
        endereco: cliente?.endereco, bairro: cliente?.bairro,
        cidade: cliente?.cidade, estado: cliente?.estado, cep: cliente?.cep,
      },
      advogado: tenant ? {
        nome: tenant.nome_responsavel ?? undefined,
        cpf: tenant.cpf_responsavel ?? undefined,
        rg: tenant.rg_responsavel ?? undefined,
        orgao_expedidor: tenant.orgao_expedidor ?? undefined,
        estado_civil: tenant.estado_civil ?? undefined,
        nacionalidade: tenant.nacionalidade ?? undefined,
        oab_numero: tenant.oab_numero ?? undefined,
        oab_estado: tenant.oab_estado ?? undefined,
        telefone: tenant.telefone ?? undefined,
        email: tenant.email_profissional ?? undefined,
        endereco: tenant.endereco ?? undefined,
        bairro: tenant.bairro ?? undefined,
        cidade: tenant.cidade ?? undefined,
        estado: tenant.estado ?? undefined,
        cep: tenant.cep ?? undefined,
      } : undefined,
      contrato: {
        area: contrato.area ?? atendimento?.area,
        valor_fixo: contrato.valor_fixo,
        percentual_exito: contrato.percentual_exito,
        forma_pagamento: contrato.forma_pagamento,
      },
      resumoCaso,
    }

    const sseHeaders = {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Contrato-Id': contratoId,
      'Access-Control-Expose-Headers': 'X-Contrato-Id',
    }

    // ── FLUXO COM MODELO: IA segue o modelo e preenche os dados ─────────────
    console.log('[gerar-contrato] FLUXO:', modeloTexto ? 'COM MODELO' : 'SEM MODELO (IA gera do zero)')
    if (modeloTexto) {
      const promptComModelo = `
## MODELO DE CONTRATO DO ADVOGADO

${modeloTexto.substring(0, 8000)}

---

## DADOS DO SISTEMA PARA PREENCHIMENTO

### Cliente (Contratante)
- Nome: ${dadosSubstituicao.cliente.nome || '[NÃO INFORMADO]'}
- Nacionalidade: ${dadosSubstituicao.cliente.nacionalidade || '[NÃO INFORMADO]'}
- Estado civil: ${dadosSubstituicao.cliente.estado_civil || '[NÃO INFORMADO]'}
- Profissão: ${dadosSubstituicao.cliente.profissao || '[NÃO INFORMADO]'}
- CPF: ${dadosSubstituicao.cliente.cpf || '[NÃO INFORMADO]'}
- RG: ${dadosSubstituicao.cliente.rg || '[NÃO INFORMADO]'}
- Órgão expedidor: ${dadosSubstituicao.cliente.orgao_expedidor || '[NÃO INFORMADO]'}
- Telefone: ${dadosSubstituicao.cliente.telefone || '[NÃO INFORMADO]'}
- E-mail: ${dadosSubstituicao.cliente.email || '[NÃO INFORMADO]'}
- Endereço: ${dadosSubstituicao.cliente.endereco || '[NÃO INFORMADO]'}
- Bairro: ${dadosSubstituicao.cliente.bairro || '[NÃO INFORMADO]'}
- Cidade: ${dadosSubstituicao.cliente.cidade || '[NÃO INFORMADO]'}
- Estado: ${dadosSubstituicao.cliente.estado || '[NÃO INFORMADO]'}
- CEP: ${dadosSubstituicao.cliente.cep || '[NÃO INFORMADO]'}

### Advogado (Contratado)
- Nome: ${dadosSubstituicao.advogado?.nome || '[NÃO INFORMADO]'}
- Nacionalidade: ${dadosSubstituicao.advogado?.nacionalidade || '[NÃO INFORMADO]'}
- Estado civil: ${dadosSubstituicao.advogado?.estado_civil || '[NÃO INFORMADO]'}
- CPF: ${dadosSubstituicao.advogado?.cpf || '[NÃO INFORMADO]'}
- RG: ${dadosSubstituicao.advogado?.rg || '[NÃO INFORMADO]'}
- Órgão expedidor: ${dadosSubstituicao.advogado?.orgao_expedidor || '[NÃO INFORMADO]'}
- OAB: ${dadosSubstituicao.advogado?.oab_numero || '[NÃO INFORMADO]'}/${dadosSubstituicao.advogado?.oab_estado || '[NÃO INFORMADO]'}
- Telefone: ${dadosSubstituicao.advogado?.telefone || '[NÃO INFORMADO]'}
- E-mail: ${dadosSubstituicao.advogado?.email || '[NÃO INFORMADO]'}
- Endereço: ${dadosSubstituicao.advogado?.endereco || '[NÃO INFORMADO]'}
- Bairro: ${dadosSubstituicao.advogado?.bairro || '[NÃO INFORMADO]'}
- Cidade: ${dadosSubstituicao.advogado?.cidade || '[NÃO INFORMADO]'}
- Estado: ${dadosSubstituicao.advogado?.estado || '[NÃO INFORMADO]'}
- CEP: ${dadosSubstituicao.advogado?.cep || '[NÃO INFORMADO]'}

### Dados do Contrato
- Área jurídica: ${dadosSubstituicao.contrato.area || '[NÃO INFORMADO]'}
- Valor fixo: ${dadosSubstituicao.contrato.valor_fixo != null ? `R$ ${dadosSubstituicao.contrato.valor_fixo.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}` : '[NÃO INFORMADO]'}
- Percentual de êxito: ${dadosSubstituicao.contrato.percentual_exito != null ? `${dadosSubstituicao.contrato.percentual_exito}%` : '[NÃO INFORMADO]'}
- Forma de pagamento: ${dadosSubstituicao.contrato.forma_pagamento || '[NÃO INFORMADO]'}
- Data do contrato: ${new Date().toLocaleDateString('pt-BR', { day: 'numeric', month: 'long', year: 'numeric' })}

### Resumo do caso
${resumoCaso || '[NÃO INFORMADO]'}

${instrucoes ? `### Instruções adicionais\n${instrucoes}` : ''}

Preencha o modelo acima com os dados fornecidos. Use a data do contrato informada acima. Mantenha campos como [PREENCHER] onde não houver dados disponíveis.
Campos preenchidos por aproximação devem ser marcados com [⚠ preenchido por aproximação].
Responda com o contrato COMPLETO em Markdown.
`.trim()

      const { stream } = await streamCompletion({
        system: SYSTEM_PREENCHER_MODELO,
        prompt: promptComModelo,
        maxTokens: 16000,
      })

      return new Response(stream, { headers: sseHeaders })
    }

    // ── FLUXO SEM MODELO: IA gera do zero ───────────────────────────────────
    const prompt = buildPromptContratoHonorarios({
      dadosContrato: {
        titulo:           contrato.titulo,
        area:             contrato.area ?? atendimento?.area,
        valor_fixo:       contrato.valor_fixo,
        percentual_exito: contrato.percentual_exito,
        forma_pagamento:  contrato.forma_pagamento,
      },
      dadosCliente: {
        nome: cliente?.nome, cpf: cliente?.cpf, rg: cliente?.rg,
        orgao_expedidor: cliente?.orgao_expedidor, estado_civil: cliente?.estado_civil,
        nacionalidade: cliente?.nacionalidade, profissao: cliente?.profissao,
        telefone: cliente?.telefone, email: cliente?.email,
        endereco: cliente?.endereco, bairro: cliente?.bairro,
        cidade: cliente?.cidade, estado: cliente?.estado, cep: cliente?.cep,
      },
      dadosAdvogado: tenant ? {
        nome: tenant.nome_responsavel ?? undefined,
        cpf: tenant.cpf_responsavel ?? undefined,
        rg: tenant.rg_responsavel ?? undefined,
        orgao_expedidor: tenant.orgao_expedidor ?? undefined,
        estado_civil: tenant.estado_civil ?? undefined,
        nacionalidade: tenant.nacionalidade ?? undefined,
        oab_numero: tenant.oab_numero ?? undefined,
        oab_estado: tenant.oab_estado ?? undefined,
        telefone: tenant.telefone ?? undefined,
        email: tenant.email_profissional ?? undefined,
        endereco: tenant.endereco ?? undefined,
        bairro: tenant.bairro ?? undefined,
        cidade: tenant.cidade ?? undefined,
        estado: tenant.estado ?? undefined,
        cep: tenant.cep ?? undefined,
      } : undefined,
      resumoCaso,
      instrucoes,
    })

    const { stream } = await streamCompletion({
      system: SYSTEM_CONTRATO_HONORARIOS,
      prompt,
      maxTokens: 6000,
    })

    return new Response(stream, { headers: sseHeaders })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Erro desconhecido'
    console.error('[gerar-contrato]', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
