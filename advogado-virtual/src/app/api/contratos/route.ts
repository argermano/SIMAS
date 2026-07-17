import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getAuthContext } from '@/lib/auth'
import { jsonError, validateBody } from '@/lib/api'
import { pertenceAoTenant } from '@/lib/ownership'
import { sincronizarPrevisaoContrato } from '@/lib/financeiro/previsao'

const schemaContrato = z.object({
  cliente_id:       z.string().uuid().optional().nullable(),
  atendimento_id:   z.string().uuid().optional().nullable(),
  area:             z.string().optional().nullable(),
  titulo:           z.string().max(300).optional(),
  valor_fixo:       z.number().positive().optional().nullable(),
  percentual_exito: z.number().min(0).max(100).optional().nullable(),
  forma_pagamento:  z.string().max(200).optional().nullable(),
})

// GET /api/contratos — lista contratos do tenant
export async function GET(req: NextRequest) {
  const auth = await getAuthContext()
  if (!auth.ok) return auth.response
  const { supabase, usuario } = auth

  const { searchParams } = new URL(req.url)
  const status = searchParams.get('status')
  const page   = parseInt(searchParams.get('page') ?? '1')
  const limit  = 20
  const offset = (page - 1) * limit

  let query = supabase
    .from('contratos_honorarios')
    .select('*, clientes(nome)', { count: 'exact' })
    .eq('tenant_id', usuario.tenant_id)
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1)

  if (status) query = query.eq('status', status)

  const { data, error, count } = await query
  if (error) return jsonError(error.message, 500)

  return NextResponse.json({
    contratos:    data,
    total:        count ?? 0,
    pagina:       page,
    totalPaginas: Math.ceil((count ?? 0) / limit),
  })
}

// POST /api/contratos — criar contrato (rascunho)
export async function POST(req: NextRequest) {
  const auth = await getAuthContext()
  if (!auth.ok) return auth.response
  const { supabase, usuario } = auth

  const parsed = await validateBody(req, schemaContrato)
  if (!parsed.ok) return parsed.response

  const dados = parsed.data

  // A8: cliente/atendimento referenciados precisam pertencer ao tenant.
  if (dados.cliente_id && !(await pertenceAoTenant(supabase, 'clientes', dados.cliente_id, usuario.tenant_id))) {
    return jsonError('Cliente inválido', 400)
  }
  if (dados.atendimento_id && !(await pertenceAoTenant(supabase, 'atendimentos', dados.atendimento_id, usuario.tenant_id))) {
    return jsonError('Atendimento inválido', 400)
  }

  const inserir: Record<string, unknown> = {
    tenant_id:  usuario.tenant_id,
    criado_por: usuario.id,
    status:     'rascunho',
  }

  if (dados.cliente_id)       inserir.cliente_id       = dados.cliente_id
  if (dados.atendimento_id)   inserir.atendimento_id   = dados.atendimento_id
  if (dados.area)             inserir.area             = dados.area
  if (dados.titulo)           inserir.titulo           = dados.titulo
  if (dados.valor_fixo)       inserir.valor_fixo       = dados.valor_fixo
  if (dados.percentual_exito !== undefined && dados.percentual_exito !== null) {
    inserir.percentual_exito = dados.percentual_exito
  }
  if (dados.forma_pagamento)  inserir.forma_pagamento  = dados.forma_pagamento

  const { data: contrato, error } = await supabase
    .from('contratos_honorarios')
    .insert(inserir)
    .select()
    .single()

  if (error) return jsonError(error.message, 500)

  // Previsão de recebimento (best-effort): contrato com valor fixo já mostra
  // uma parcela "prevista" no financeiro até a série real ser lançada.
  await sincronizarPrevisaoContrato(supabase, contrato.id)

  return NextResponse.json({ contrato }, { status: 201 })
}
