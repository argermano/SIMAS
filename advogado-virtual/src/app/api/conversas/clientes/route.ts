import { NextRequest, NextResponse } from 'next/server'
import { getAuthContext, requireRole } from '@/lib/auth'
import { jsonError } from '@/lib/api'

// GET /api/conversas/clientes?q= — busca LEVE de clientes do tenant por nome
// para o "Vincular cliente" do PainelContexto. Só id/nome/telefone, máx. 10.
// (A rota /api/clientes existente devolve o cadastro completo descriptografado
// e pagina de 20 em 20 — pesada demais para o picker; por isso esta é dedicada.)

export async function GET(req: NextRequest) {
  const auth = await getAuthContext()
  if (!auth.ok) return auth.response
  const gate = requireRole(auth.usuario, ['admin', 'advogado'])
  if (gate) return gate
  const { supabase, usuario } = auth

  const { searchParams } = new URL(req.url)
  const q = (searchParams.get('q') ?? '').trim()

  let query = supabase
    .from('clientes')
    .select('id, nome, telefone')
    .eq('tenant_id', usuario.tenant_id)
    .is('deleted_at', null)
    .neq('status_cadastro', 'pre_cadastro') // pré-cadastros do funil ficam fora
    .order('nome', { ascending: true })
    .limit(10)
  if (q) query = query.ilike('nome', `%${q}%`)

  const { data, error } = await query
  if (error) return jsonError(error.message, 500)

  return NextResponse.json({ clientes: data ?? [] })
}
