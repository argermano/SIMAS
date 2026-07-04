import type { createClient } from '@/lib/supabase/server'
import type { TeseCurada } from './tipos'
import { TESES_PREVIDENCIARIO } from './previdenciario'
import { TESES_TRABALHISTA } from './trabalhista'
import { TESES_CIVEL } from './civel'
import { TESES_FAMILIA } from './familia'
import { TESES_MEDICO } from './medico'
import { TESES_CONSUMIDOR } from './consumidor'

export type { TeseCurada, EmentaCurada } from './tipos'

type SupabaseServer = Awaited<ReturnType<typeof createClient>>

// Teto de teses injetadas por área (proteção do tamanho do prompt).
const MAX_TESES_INJETADAS = 15

// ─── Template no repositório (apenas EXEMPLO de formato; a base real vive no
//     banco, tabela teses_escritorio — ver Fase 3). Mantido para referência. ───
export const TEMPLATE_POR_AREA: Record<string, TeseCurada[]> = {
  previdenciario: TESES_PREVIDENCIARIO,
  trabalhista:    TESES_TRABALHISTA,
  civel:          TESES_CIVEL,
  familia:        TESES_FAMILIA,
  medico:         TESES_MEDICO,
  consumidor:     TESES_CONSUMIDOR,
}

// ─── Base real (banco, por tenant) ───────────────────────────────────────────

export interface TeseDB {
  id: string
  area: string
  tese: string
  dispositivos: string[]
  sumulas: string[]
  ementas: Array<{ tribunal?: string; processo?: string; relator?: string; julgamento?: string; ementa?: string; fonteUrl?: string }>
  quando_usar?: string | null
}

/** Teses APROVADAS de uma área do tenant (para injeção e biblioteca). */
export async function tesesAprovadas(supabase: SupabaseServer, tenantId: string, area: string): Promise<TeseDB[]> {
  const { data } = await supabase
    .from('teses_escritorio')
    .select('id, area, tese, dispositivos, sumulas, ementas, quando_usar')
    .eq('tenant_id', tenantId)
    .eq('area', area)
    .eq('status', 'aprovada')
    .order('aprovada_em', { ascending: false })
    .limit(MAX_TESES_INJETADAS)
  return (data ?? []) as TeseDB[]
}

/**
 * Bloco de FUNDAMENTAÇÃO VERIFICADA para injetar no prompt de geração. Vazio se
 * a área do tenant não tem tese aprovada. As citações aqui foram conferidas por
 * humano → o modelo pode usá-las literalmente, SEM [VERIFICAR]. Best-effort:
 * qualquer falha de leitura devolve '' (nunca derruba a geração).
 */
export async function blocoFundamentacaoParaPrompt(supabase: SupabaseServer, tenantId: string, area: string): Promise<string> {
  let teses: TeseDB[] = []
  try {
    teses = await tesesAprovadas(supabase, tenantId, area)
  } catch {
    return ''
  }
  if (teses.length === 0) return ''

  const linhas = teses.map((t) => {
    const cits = [...(t.dispositivos ?? []), ...(t.sumulas ?? [])].filter(Boolean).join('; ')
    const ementas = (t.ementas ?? [])
      .filter((e) => e.ementa)
      .map((e) => `  > "${e.ementa}" (${[e.tribunal, e.processo, e.relator, e.julgamento && `j. ${e.julgamento}`].filter(Boolean).join(', ')})`)
      .join('\n')
    return [
      `- TESE: ${t.tese}`,
      cits ? `  Fundamentos: ${cits}` : '',
      t.quando_usar ? `  Quando usar: ${t.quando_usar}` : '',
      ementas,
    ].filter(Boolean).join('\n')
  }).join('\n')

  return `\n\n## FUNDAMENTAÇÃO VERIFICADA PELO ESCRITÓRIO\nAs teses, dispositivos e ementas abaixo foram CONFERIDOS por advogado do escritório — você PODE usá-los literalmente na fundamentação, SEM marcar [VERIFICAR]. Use apenas os pertinentes ao caso concreto. Qualquer OUTRA jurisprudência mencionada de conhecimento próprio continua exigindo [VERIFICAR].\n\n${linhas}`
}
