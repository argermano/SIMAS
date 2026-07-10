import { NextResponse } from 'next/server'
import { getAuthContext, requireRole } from '@/lib/auth'
import { jsonError } from '@/lib/api'
import type { Pessoa } from '@/lib/agenda/tipos'

// GET /api/agenda/pessoas -> { pessoas: [{ id, nome }] }
// Usuários ATIVOS do tenant, para o filtro "Pessoas" da agenda.
export async function GET() {
  const auth = await getAuthContext()
  if (!auth.ok) return auth.response
  const gate = requireRole(auth.usuario, ['admin', 'advogado', 'colaborador'])
  if (gate) return gate
  const { supabase, usuario } = auth

  const { data, error } = await supabase
    .from('users')
    .select('id, nome')
    .eq('tenant_id', usuario.tenant_id)
    .eq('status', 'ativo')
    .order('nome', { ascending: true })
  if (error) return jsonError(error.message, 500)

  const pessoas: Pessoa[] = (data ?? []).map(u => ({ id: u.id, nome: u.nome ?? '' }))
  return NextResponse.json({ pessoas })
}
