import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Categorização de endpoints de IA e limites por plano.
 * Fonte única de verdade — usada tanto pelo dashboard de consumo
 * (api/configuracoes/uso-ia) quanto pelo enforcement de cota nas rotas.
 *
 * Endpoints dinâmicos (`comando_*`, `correcao_*`) são agrupados por prefixo.
 */
export const CATEGORIAS: Record<string, { label: string; grupo: string; chave: string }> = {
  gerar_peca:     { label: 'Geração de peças',         grupo: 'Documentos', chave: 'gerar_peca' },
  refinar_peca:   { label: 'Refinamento de peças',     grupo: 'Documentos', chave: 'refinar_peca' },
  validar_peca:   { label: 'Validação de peças',       grupo: 'Documentos', chave: 'validar_peca' },
  analise:        { label: 'Análise de documentos',     grupo: 'Análise',   chave: 'analise' },
  analise_geral:  { label: 'Análise geral do caso',    grupo: 'Análise',   chave: 'analise_geral' },
  comando:        { label: 'Comandos IA no editor',    grupo: 'Editor',    chave: 'comando' },
  correcao:       { label: 'Correção automática',      grupo: 'Editor',    chave: 'correcao' },
}

/** Limites por plano (chamadas permitidas por categoria, por mês corrente). */
export const LIMITES_PLANO: Record<string, Record<string, number>> = {
  trial: {
    gerar_peca:    50,
    refinar_peca:  50,
    validar_peca:  30,
    analise:       20,
    analise_geral: 100,
    comando:       200,
    correcao:      200,
  },
  basico: {
    gerar_peca:    200,
    refinar_peca:  200,
    validar_peca:  100,
    analise:       100,
    analise_geral: 500,
    comando:       1000,
    correcao:      1000,
  },
  profissional: {
    gerar_peca:    1000,
    refinar_peca:  1000,
    validar_peca:  500,
    analise:       500,
    analise_geral: 2000,
    comando:       5000,
    correcao:      5000,
  },
}

export function categorizar(endpoint: string): { label: string; grupo: string; chave: string } {
  if (CATEGORIAS[endpoint]) return CATEGORIAS[endpoint]
  if (endpoint.startsWith('comando_')) return CATEGORIAS.comando
  if (endpoint.startsWith('correcao_')) return CATEGORIAS.correcao
  return { label: endpoint, grupo: 'Outros', chave: endpoint }
}

export interface ResultadoCota {
  permitido: boolean
  limite: number
  usados: number
  chave: string
  plano: string
}

/**
 * Verifica se o tenant ainda tem cota para a categoria do endpoint no mês corrente.
 * Categorias sem limite definido (ex.: chat_diagnostico) nunca bloqueiam.
 */
export async function verificarCota(
  supabase: SupabaseClient,
  tenantId: string,
  endpoint: string,
): Promise<ResultadoCota> {
  const { chave } = categorizar(endpoint)

  const { data: tenant } = await supabase
    .from('tenants')
    .select('plano')
    .eq('id', tenantId)
    .single()

  const plano = (tenant?.plano as string | undefined) ?? 'trial'
  const limites = LIMITES_PLANO[plano] ?? LIMITES_PLANO.trial
  const limite = limites[chave]

  // Categoria sem limite definido → não faz enforcement
  if (limite == null) return { permitido: true, limite: Infinity, usados: 0, chave, plano }

  // Início do mês corrente (UTC)
  const agora = new Date()
  const inicioMes = new Date(Date.UTC(agora.getUTCFullYear(), agora.getUTCMonth(), 1)).toISOString()

  let q = supabase
    .from('api_usage_log')
    .select('id', { count: 'exact', head: true })
    .eq('tenant_id', tenantId)
    .gte('created_at', inicioMes)

  // comando_* / correcao_* são agrupados por prefixo
  q = chave === 'comando' || chave === 'correcao'
    ? q.ilike('endpoint', `${chave}%`)
    : q.eq('endpoint', chave)

  const { count } = await q
  const usados = count ?? 0

  return { permitido: usados < limite, limite, usados, chave, plano }
}

/** Resposta padrão 429 quando a cota é excedida. */
export function mensagemCotaExcedida(cota: ResultadoCota): string {
  return `Limite do plano "${cota.plano}" atingido para esta operação (${cota.usados}/${cota.limite} neste mês). Faça upgrade do plano para continuar.`
}
