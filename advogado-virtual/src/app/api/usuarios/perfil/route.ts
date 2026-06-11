import { NextRequest, NextResponse } from 'next/server'
import { getAuthContext } from '@/lib/auth'
import { jsonError } from '@/lib/api'
import { z } from 'zod'

const schemaPerfil = z.object({
  nome: z.string().max(200).optional(),
})

// PATCH /api/usuarios/perfil — o usuário atualiza seu próprio perfil
export async function PATCH(req: NextRequest) {
  const auth = await getAuthContext()
  if (!auth.ok) return auth.response
  const { supabase, usuario } = auth

  const body = await req.json()
  const resultado = schemaPerfil.safeParse(body)

  if (!resultado.success) {
    return jsonError('Dados inválidos', 400, resultado.error.flatten())
  }

  const { data: atualizado, error } = await supabase
    .from('users')
    .update(resultado.data)
    .eq('id', usuario.id)
    .select('id, nome')
    .single()

  if (error) return jsonError(error.message, 500)

  return NextResponse.json({ usuario: atualizado })
}
