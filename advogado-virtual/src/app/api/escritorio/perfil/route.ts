import { NextRequest, NextResponse } from 'next/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { z } from 'zod'
import { getAuthContext } from '@/lib/auth'
import { jsonError, validateBody } from '@/lib/api'

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
  const auth = await getAuthContext()
  if (!auth.ok) return auth.response
  const { usuario } = auth

  if (usuario.role !== 'admin') {
    return jsonError('Apenas administradores podem alterar dados do escritório', 403)
  }

  const parsed = await validateBody(req, schemaPerfil)
  if (!parsed.ok) return parsed.response

  const dados: Record<string, string | null> = {}
  for (const [k, v] of Object.entries(parsed.data)) {
    dados[k] = v || null
  }

  const adminDb = getAdminSupabase()

  const { data: atualizado, error } = await adminDb
    .from('tenants')
    .update(dados)
    .eq('id', usuario.tenant_id)
    .select('id, nome_responsavel, oab_numero, oab_estado, cpf_responsavel, rg_responsavel, orgao_expedidor, estado_civil, nacionalidade, telefone, email_profissional, endereco, bairro, cidade, estado, cep')
    .single()

  if (error) return jsonError(error.message, 500)

  return NextResponse.json({ escritorio: atualizado })
}
