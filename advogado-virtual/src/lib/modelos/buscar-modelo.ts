import { SupabaseClient } from '@supabase/supabase-js'

/**
 * Busca o modelo padrão do escritório para um tipo de documento.
 * Prioridade: modelo específico do subtipo > modelo "todos" (fallback) > null
 */
export async function buscarModeloPadrao(
  supabase: SupabaseClient,
  tenantId: string,
  tipo: 'peca' | 'contrato' | 'procuracao' | 'declaracao',
  subtipo: string,
): Promise<string | null> {
  // 1. Buscar modelo específico para o subtipo
  const { data: especifico } = await supabase
    .from('modelos_documento')
    .select('conteudo_markdown')
    .eq('tenant_id', tenantId)
    .eq('tipo', tipo)
    .eq('subtipo', subtipo)
    .single()

  if (especifico?.conteudo_markdown) {
    return especifico.conteudo_markdown
  }

  // 2. Fallback: buscar modelo "todos"
  const { data: geral } = await supabase
    .from('modelos_documento')
    .select('conteudo_markdown')
    .eq('tenant_id', tenantId)
    .eq('tipo', tipo)
    .eq('subtipo', 'todos')
    .single()

  return geral?.conteudo_markdown ?? null
}
