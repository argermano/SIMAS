import type { createClient } from '@/lib/supabase/server'

type SupabaseServer = Awaited<ReturnType<typeof createClient>>

/**
 * Verifica se um registro referenciado por FK pertence ao tenant do usuário.
 *
 * Motivação (A8): as rotas de criação (atendimentos, contratos, tasks) aceitavam
 * IDs vindos do corpo da requisição e inseriam sem checar propriedade. As FKs no
 * SQL só exigem que o alvo exista (não são tenant-scoped) e a RLS valida o
 * tenant_id do PRÓPRIO registro inserido, não o do alvo referenciado — então um
 * pedido forjado podia criar vínculos apontando para IDs de outro tenant.
 *
 * Usa a sessão do usuário (RLS ativa): se o alvo for de outro tenant, a query
 * não o enxerga e retorna false. Tabelas com soft-delete são filtradas por
 * deleted_at IS NULL quando aplicável.
 */
export async function pertenceAoTenant(
  supabase: SupabaseServer,
  tabela: 'clientes' | 'atendimentos' | 'users' | 'contratos_honorarios',
  id: string,
  tenantId: string,
  opts: { ignorarSoftDelete?: boolean } = {},
): Promise<boolean> {
  let query = supabase.from(tabela).select('id').eq('id', id).eq('tenant_id', tenantId)
  if (!opts.ignorarSoftDelete && (tabela === 'clientes' || tabela === 'atendimentos')) {
    query = query.is('deleted_at', null)
  }
  const { data } = await query.maybeSingle()
  return !!data
}
