import { NextResponse } from 'next/server'
import type { User } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/server'

/**
 * Contexto de autenticação compartilhado por todas as rotas.
 * Elimina o boilerplate repetido de createClient + getUser + lookup de users
 * e padroniza as respostas de erro (401/404).
 *
 * Uso:
 *   const auth = await getAuthContext()
 *   if (!auth.ok) return auth.response
 *   const { supabase, usuario } = auth
 */

export interface Usuario {
  id: string
  nome: string | null
  tenant_id: string
  role: string
}

type SupabaseServer = Awaited<ReturnType<typeof createClient>>

export type AuthContext =
  | { ok: true; supabase: SupabaseServer; user: User; usuario: Usuario }
  | { ok: false; response: NextResponse }

export async function getAuthContext(): Promise<AuthContext> {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return { ok: false, response: NextResponse.json({ error: 'Não autenticado' }, { status: 401 }) }
  }

  const { data: usuario } = await supabase
    .from('users')
    .select('id, nome, tenant_id, role')
    .eq('auth_user_id', user.id)
    .single()

  if (!usuario) {
    return { ok: false, response: NextResponse.json({ error: 'Usuário não encontrado' }, { status: 404 }) }
  }

  return { ok: true, supabase, user, usuario: usuario as Usuario }
}

/** Retorna uma resposta 403 se o usuário não tiver um dos papéis exigidos, ou null se ok. */
export function requireRole(usuario: Usuario, roles: string[]): NextResponse | null {
  if (roles.includes(usuario.role)) return null
  return NextResponse.json({ error: 'Sem permissão' }, { status: 403 })
}
