import type { createClient } from '@/lib/supabase/server'
import { TABELA_POR_TIPO, type Vinculo } from './vinculo'

type Db = Awaited<ReturnType<typeof createClient>>

/**
 * Valida que o alvo do vínculo existe E pertence ao tenant (defesa em profundidade:
 * a RLS protege a própria task, não o registro referenciado). Usa a sessão do
 * usuário — alvo de outro tenant não é enxergado e retorna false.
 */
export async function vinculoValido(db: Db, v: Vinculo, tenantId: string): Promise<boolean> {
  const tabela = TABELA_POR_TIPO[v.tipo]
  let q = db.from(tabela).select('id').eq('id', v.id).eq('tenant_id', tenantId)
  if (tabela === 'clientes' || tabela === 'atendimentos') q = q.is('deleted_at', null)
  const { data } = await q.maybeSingle()
  return !!data
}
