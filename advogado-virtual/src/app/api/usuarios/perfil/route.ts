import { NextRequest, NextResponse } from 'next/server'
import { getAuthContext } from '@/lib/auth'
import { jsonError } from '@/lib/api'
import { z } from 'zod'

const schemaPerfil = z.object({
  nome: z.string().max(200).optional(),
})

// GET /api/usuarios/perfil — dados leves do usuário logado (id + unidade), usados
// pelo modal de WhatsApp para pré-selecionar o número de saída por unidade.
export async function GET() {
  const auth = await getAuthContext()
  if (!auth.ok) return auth.response
  const { usuario } = auth
  return NextResponse.json({ usuario: { id: usuario.id, unidade: usuario.unidade } })
}

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
