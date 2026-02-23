import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { z } from 'zod'

const schemaUpdate = z.object({
  titulo:           z.string().max(300).optional(),
  conteudo_markdown: z.string().optional(),
  valor_fixo:       z.number().positive().optional().nullable(),
  percentual_exito: z.number().min(0).max(100).optional().nullable(),
  forma_pagamento:  z.string().max(200).optional().nullable(),
  modelo_advogado_url: z.string().optional().nullable(),
})

async function verificarAcesso(
  supabase: Awaited<ReturnType<typeof createClient>>,
  contratoId: string
) {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  const { data: usuario } = await supabase
    .from('users')
    .select('id, tenant_id, role')
    .eq('auth_user_id', user.id)
    .single()

  if (!usuario) return null

  const { data: contrato } = await supabase
    .from('contratos_honorarios')
    .select('*')
    .eq('id', contratoId)
    .eq('tenant_id', usuario.tenant_id)
    .single()

  return contrato ? { contrato, usuario } : null
}

// GET /api/contratos/[id]
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const supabase = await createClient()
  const acesso = await verificarAcesso(supabase, id)

  if (!acesso) return NextResponse.json({ error: 'Não encontrado' }, { status: 404 })

  // Buscar versões
  const { data: versoes } = await supabase
    .from('contratos_versoes')
    .select('id, versao, created_at')
    .eq('contrato_id', id)
    .order('versao', { ascending: false })

  // Buscar dados do cliente e atendimento
  const { data: detalhe } = await supabase
    .from('contratos_honorarios')
    .select('*, clientes(nome, cpf, endereco, cidade, estado), atendimentos(transcricao_editada, transcricao_raw, area, pedidos_especificos)')
    .eq('id', id)
    .single()

  return NextResponse.json({
    contrato: detalhe ?? acesso.contrato,
    versoes:  versoes ?? [],
  })
}

// PATCH /api/contratos/[id]
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const supabase = await createClient()
  const acesso = await verificarAcesso(supabase, id)

  if (!acesso) return NextResponse.json({ error: 'Não encontrado' }, { status: 404 })

  const body = await req.json()
  const resultado = schemaUpdate.safeParse(body)

  if (!resultado.success) {
    return NextResponse.json(
      { error: 'Dados inválidos', detalhes: resultado.error.flatten() },
      { status: 400 }
    )
  }

  const dados   = resultado.data
  const contrato = acesso.contrato

  // Se o conteúdo mudou, salvar versão anterior
  if (dados.conteudo_markdown && dados.conteudo_markdown !== contrato.conteudo_markdown && contrato.conteudo_markdown) {
    await supabase.from('contratos_versoes').insert({
      contrato_id:      id,
      conteudo_markdown: contrato.conteudo_markdown,
      versao:           contrato.versao,
    })
  }

  const atualizacao: Record<string, unknown> = { ...dados }
  if (dados.conteudo_markdown && dados.conteudo_markdown !== contrato.conteudo_markdown) {
    atualizacao.versao = (contrato.versao ?? 1) + 1
  }

  const { data: atualizado, error } = await supabase
    .from('contratos_honorarios')
    .update(atualizacao)
    .eq('id', id)
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ contrato: atualizado })
}

// DELETE /api/contratos/[id]
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const supabase = await createClient()
  const acesso = await verificarAcesso(supabase, id)

  if (!acesso) return NextResponse.json({ error: 'Não encontrado' }, { status: 404 })

  // Somente admin/advogado podem deletar
  if (!['admin', 'advogado'].includes(acesso.usuario.role)) {
    return NextResponse.json({ error: 'Sem permissão' }, { status: 403 })
  }

  const { error } = await supabase
    .from('contratos_honorarios')
    .delete()
    .eq('id', id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ ok: true })
}
