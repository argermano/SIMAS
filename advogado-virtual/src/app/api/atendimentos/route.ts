import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getAuthContext } from '@/lib/auth'
import { jsonError, validateBody } from '@/lib/api'
import { pertenceAoTenant } from '@/lib/ownership'

// GET /api/atendimentos?cliente_id=UUID — lista atendimentos de um cliente
export async function GET(req: NextRequest) {
  const auth = await getAuthContext()
  if (!auth.ok) return auth.response
  const { supabase, usuario } = auth

  const clienteId = new URL(req.url).searchParams.get('cliente_id')
  if (!clienteId) return jsonError('cliente_id obrigatório', 400)

  const { data } = await supabase
    .from('atendimentos')
    .select('id, area, tipo_peca_origem, status, created_at')
    .eq('cliente_id', clienteId)
    .eq('tenant_id', usuario.tenant_id)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })

  return NextResponse.json({ atendimentos: data ?? [] })
}

const schemaNovoAtendimento = z.object({
  cliente_id:       z.string().uuid(),
  area:             z.string().min(1),
  tipo_peca_origem: z.string().nullable().optional(),
  tipo_servico:     z.enum(['administrativo', 'judicial']).nullable().optional(),
  tipo_processo:    z.string().nullable().optional(),
  modo_input:       z.enum(['audio', 'texto']).default('texto'),
})

// POST /api/atendimentos — cria novo atendimento
export async function POST(req: Request) {
  const auth = await getAuthContext()
  if (!auth.ok) return auth.response
  const { supabase, usuario } = auth

  const parsed = await validateBody(req, schemaNovoAtendimento)
  if (!parsed.ok) return parsed.response

  const dados = parsed.data

  // A8: o cliente referenciado precisa pertencer ao tenant do usuário.
  if (!(await pertenceAoTenant(supabase, 'clientes', dados.cliente_id, usuario.tenant_id))) {
    return jsonError('Cliente inválido', 400)
  }

  // Monta o objeto de inserção sem incluir campos nulos de colunas opcionais
  // (evita erro de schema cache quando a migration ainda não foi aplicada)
  const inserir: Record<string, unknown> = {
    tenant_id:        usuario.tenant_id,
    cliente_id:       dados.cliente_id,
    user_id:          usuario.id,
    area:             dados.area,
    modo_input:       dados.modo_input,
    status:           'caso_novo',
  }
  if (dados.tipo_peca_origem) inserir.tipo_peca_origem = dados.tipo_peca_origem
  if (dados.tipo_servico)     inserir.tipo_servico     = dados.tipo_servico
  if (dados.tipo_processo)    inserir.tipo_processo    = dados.tipo_processo

  const { data: atendimento, error } = await supabase
    .from('atendimentos')
    .insert(inserir)
    .select('id')
    .single()

  if (error) return jsonError(error.message, 500)

  return NextResponse.json({ id: atendimento.id }, { status: 201 })
}
