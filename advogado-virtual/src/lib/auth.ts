import { NextResponse } from 'next/server'
import type { User } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/server'
import type { UserStatus } from '@/types'

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
  /** Unidade do membro; deriva a instância padrão de saída do WhatsApp. null = sem preferência. */
  unidade: string | null
  /** Situação da conta no escritório. Só 'ativo' acessa; 'inativo' perde o acesso mesmo com a sessão do Supabase ainda válida. */
  status: UserStatus
}

/**
 * Conta ativa = pode acessar. Desativar alguém grava users.status='inativo', mas a
 * sessão do Supabase continua válida (não conhece essa coluna) — por isso o corte é
 * feito no lookup do perfil, não no auth.getUser(). null/undefined barra por precaução.
 */
export function usuarioAtivo(status: string | null | undefined): boolean {
  return status === 'ativo'
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
    .select('id, nome, tenant_id, role, unidade, status')
    .eq('auth_user_id', user.id)
    .single()

  if (!usuario) {
    return { ok: false, response: NextResponse.json({ error: 'Usuário não encontrado' }, { status: 404 }) }
  }

  // Conta desativada: corta o acesso aqui, cobrindo de uma vez todas as rotas que
  // passam por getAuthContext. Rotas autônomas (webhooks/ics/integracao/cron) não
  // chegam aqui e seguem com sua própria autenticação.
  if (!usuarioAtivo((usuario as Usuario).status)) {
    return { ok: false, response: NextResponse.json({ error: 'Usuário desativado' }, { status: 403 }) }
  }

  return { ok: true, supabase, user, usuario: usuario as Usuario }
}

/** Retorna uma resposta 403 se o usuário não tiver um dos papéis exigidos, ou null se ok. */
export function requireRole(usuario: Usuario, roles: string[]): NextResponse | null {
  if (roles.includes(usuario.role)) return null
  return NextResponse.json({ error: 'Sem permissão' }, { status: 403 })
}
