import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { z } from 'zod'

const ESTADOS_BR = ['AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS',
  'MG','PA','PB','PR','PE','PI','RJ','RN','RS','RO','RR','SC','SP','SE','TO']

const schemaPerfil = z.object({
  oab_numero:            z.string().max(20).optional().nullable(),
  oab_estado:            z.string().refine(v => !v || ESTADOS_BR.includes(v)).optional().nullable(),
  telefone_profissional: z.string().max(30).optional().nullable(),
  email_profissional:    z.string().email().optional().nullable().or(z.literal('')),
  endereco_profissional: z.string().max(500).optional().nullable(),
  cidade_profissional:   z.string().max(100).optional().nullable(),
  estado_profissional:   z.string().refine(v => !v || ESTADOS_BR.includes(v)).optional().nullable(),
  cep_profissional:      z.string().max(10).optional().nullable(),
})

// PATCH /api/usuarios/perfil — o usuário atualiza seu próprio perfil profissional
export async function PATCH(req: NextRequest) {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })

  const { data: usuario } = await supabase
    .from('users')
    .select('id')
    .eq('auth_user_id', user.id)
    .single()

  if (!usuario) return NextResponse.json({ error: 'Usuário não encontrado' }, { status: 404 })

  const body = await req.json()
  const resultado = schemaPerfil.safeParse(body)

  if (!resultado.success) {
    return NextResponse.json(
      { error: 'Dados inválidos', detalhes: resultado.error.flatten() },
      { status: 400 }
    )
  }

  const dados = {
    ...resultado.data,
    email_profissional: resultado.data.email_profissional || null,
  }

  const { data: atualizado, error } = await supabase
    .from('users')
    .update(dados)
    .eq('id', usuario.id)
    .select('id, oab_numero, oab_estado, telefone_profissional, email_profissional, endereco_profissional, cidade_profissional, estado_profissional, cep_profissional')
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ usuario: atualizado })
}
