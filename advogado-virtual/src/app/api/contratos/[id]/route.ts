import { NextRequest, NextResponse } from 'next/server'
import { getAuthContext } from '@/lib/auth'
import { jsonError } from '@/lib/api'
import type { Usuario } from '@/lib/auth'
import type { createClient } from '@/lib/supabase/server'
import { decryptTranscricaoFields } from '@/lib/encryption'
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
  usuario: Usuario,
  contratoId: string
) {
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
  const auth = await getAuthContext()
  if (!auth.ok) return auth.response
  const { supabase, usuario } = auth
  const acesso = await verificarAcesso(supabase, usuario, id)

  if (!acesso) return jsonError('Não encontrado', 404)

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

  // Decifra a transcrição aninhada do atendimento antes de devolver.
  const detalheDec = detalhe as { atendimentos?: Record<string, unknown> | null } | null
  if (detalheDec?.atendimentos) {
    detalheDec.atendimentos = decryptTranscricaoFields(detalheDec.atendimentos)
  }

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
  const auth = await getAuthContext()
  if (!auth.ok) return auth.response
  const { supabase, usuario } = auth
  const acesso = await verificarAcesso(supabase, usuario, id)

  if (!acesso) return jsonError('Não encontrado', 404)

  const body = await req.json()
  const resultado = schemaUpdate.safeParse(body)

  if (!resultado.success) {
    return jsonError('Dados inválidos', 400, resultado.error.flatten())
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

  if (error) return jsonError(error.message, 500)

  return NextResponse.json({ contrato: atualizado })
}

// DELETE /api/contratos/[id]
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const auth = await getAuthContext()
  if (!auth.ok) return auth.response
  const { supabase, usuario } = auth
  const acesso = await verificarAcesso(supabase, usuario, id)

  if (!acesso) return jsonError('Não encontrado', 404)

  // Somente admin/advogado podem deletar
  if (!['admin', 'advogado'].includes(acesso.usuario.role)) {
    return jsonError('Sem permissão', 403)
  }

  const { error } = await supabase
    .from('contratos_honorarios')
    .delete()
    .eq('id', id)

  if (error) return jsonError(error.message, 500)

  return NextResponse.json({ ok: true })
}
