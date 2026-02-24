import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { z } from 'zod'

const ESTADOS_BR = ['AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS',
  'MG','PA','PB','PR','PE','PI','RJ','RN','RS','RO','RR','SC','SP','SE','TO']

const schemaPerfil = z.object({
  nome_responsavel:   z.string().max(200).optional().nullable(),
  oab_numero:         z.string().max(20).optional().nullable(),
  oab_estado:         z.string().refine(v => !v || ESTADOS_BR.includes(v)).optional().nullable(),
  cpf_responsavel:    z.string().max(20).optional().nullable(),
  rg_responsavel:     z.string().max(30).optional().nullable(),
  orgao_expedidor:    z.string().max(50).optional().nullable(),
  estado_civil:       z.string().max(50).optional().nullable(),
  nacionalidade:      z.string().max(50).optional().nullable(),
  telefone:           z.string().max(30).optional().nullable(),
  email_profissional: z.string().email().optional().nullable().or(z.literal('')),
  endereco:           z.string().max(500).optional().nullable(),
  bairro:             z.string().max(100).optional().nullable(),
  cidade:             z.string().max(100).optional().nullable(),
  estado:             z.string().refine(v => !v || ESTADOS_BR.includes(v)).optional().nullable(),
  cep:                z.string().max(10).optional().nullable(),
})

function getAdminSupabase() {
  return createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )
}

// PATCH /api/escritorio/perfil — atualiza dados profissionais do escritório (admin only)
export async function PATCH(req: NextRequest) {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })

  const { data: usuario } = await supabase
    .from('users')
    .select('id, tenant_id, role')
    .eq('auth_user_id', user.id)
    .single()

  if (!usuario) return NextResponse.json({ error: 'Usuário não encontrado' }, { status: 404 })
  if (usuario.role !== 'admin') {
    return NextResponse.json({ error: 'Apenas administradores podem alterar dados do escritório' }, { status: 403 })
  }

  const body = await req.json()
  const resultado = schemaPerfil.safeParse(body)

  if (!resultado.success) {
    return NextResponse.json(
      { error: 'Dados inválidos', detalhes: resultado.error.flatten() },
      { status: 400 }
    )
  }

  const dados: Record<string, string | null> = {}
  for (const [k, v] of Object.entries(resultado.data)) {
    dados[k] = v || null
  }

  const adminDb = getAdminSupabase()

  const { data: atualizado, error } = await adminDb
    .from('tenants')
    .update(dados)
    .eq('id', usuario.tenant_id)
    .select('id, nome_responsavel, oab_numero, oab_estado, cpf_responsavel, rg_responsavel, orgao_expedidor, estado_civil, nacionalidade, telefone, email_profissional, endereco, bairro, cidade, estado, cep')
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ escritorio: atualizado })
}
