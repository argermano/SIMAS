// Camada de SERVIDOR da inferência de área: reúne os sinais (processo +
// publicação de origem) e, só quando a regra determinística fica na dúvida
// (confiança 'baixa'), aciona UMA chamada de IA como desempate. Fica fora dos
// route.ts (que só exportam handlers) e separado do módulo PURO area-inferida.ts
// (que não pode importar SDK/DB) — a rota /criar-caso e o preview do assistente
// importam daqui.
//
// LGPD: nunca logamos o inteiro teor — só tamanhos/ids/contagens. A IA passa
// pela cota/uso da casa (endpoint 'inferir_area') e por um timeout curto; em
// qualquer falha volta 'baixa' e a UI pede a escolha manual (nada é automático).

import type { createClient } from '@/lib/supabase/server'
import { logger } from '@/lib/logger'
import { completionJSON, DEFAULT_MODEL } from '@/lib/anthropic/client'
import { verificarCota } from '@/lib/anthropic/quota'
import { logUsage } from '@/lib/anthropic/usage'
import { extrairTextoPlano } from '@/lib/processos/djen'
import { cacheAtual, type SugestoesIA } from '@/lib/publicacoes/sugestoes-prompt'
import { z } from 'zod'
import { AREAS, type AreaId } from '@/lib/constants/areas'
import { inferirAreaDoProcesso, type AreaInferida, type SinaisArea } from './area-inferida'

type Db = Awaited<ReturnType<typeof createClient>>

const IA_TIMEOUT_MS = 8_000
const IA_MAX_TOKENS = 20
// Inteiro teor enviado à IA (curto): classe/órgão + um trecho basta para a área.
const TEOR_MAX_CHARS = 1_500

/** Sinais coletados do vínculo da tarefa + material da publicação de origem. */
export interface SinaisCaso extends SinaisArea {
  /** Inteiro teor (texto plano) da publicação de origem, se houver. */
  inteiroTeor: string | null
  /** Data de disponibilização da publicação (YYYY-MM-DD) — cabeçalho do registro. */
  publicacaoData: string | null
  /** Nº do processo mascarado (CNJ) na publicação — usado no título quando não há processo. */
  numeroMascara: string | null
  /** Resumo/análise CACHEADO das sugestões da IA (`sugestoes_ia.resumo`), quando o
   * cache é da VERSÃO atual — é o texto que o advogado espera como relato do caso.
   * Ausente/versão antiga ⇒ null (o chamador cai no resumo por IA ou no inteiro teor). */
  sugestoesResumo: string | null
}

/**
 * Reúne os sinais de área a partir do processo vinculado e/ou da publicação de
 * origem (`origin_reference` = "publicacao:<id>"). Leituras escopadas por tenant
 * (defesa em profundidade além da RLS). Classe/órgão do processo têm prioridade;
 * a publicação preenche as lacunas e fornece o inteiro teor.
 */
export async function coletarSinaisCaso(
  db: Db,
  tenantId: string,
  input: { processoId: string | null; originReference: string | null },
): Promise<SinaisCaso> {
  let classe: string | null = null
  let orgaoJulgador: string | null = null
  let assuntos: string[] = []
  let inteiroTeor: string | null = null
  let publicacaoData: string | null = null
  let numeroMascara: string | null = null
  let sugestoesResumo: string | null = null

  if (input.processoId) {
    const { data: proc } = await db
      .from('processos')
      .select('classe, orgao_julgador, assuntos')
      .eq('id', input.processoId)
      .eq('tenant_id', tenantId)
      .maybeSingle()
    if (proc) {
      classe = (proc.classe as string | null) ?? null
      orgaoJulgador = (proc.orgao_julgador as string | null) ?? null
      const a = proc.assuntos as unknown
      if (Array.isArray(a)) assuntos = a.map((x) => String(x)).filter(Boolean)
    }
  }

  const pubId = input.originReference?.startsWith('publicacao:')
    ? input.originReference.slice('publicacao:'.length)
    : null
  if (pubId) {
    const { data: pub } = await db
      .from('publicacoes')
      .select('nome_classe, orgao_julgador, texto, data_disponibilizacao, numero_mascara, sugestoes_ia')
      .eq('id', pubId)
      .eq('tenant_id', tenantId)
      .maybeSingle()
    if (pub) {
      classe = classe ?? ((pub.nome_classe as string | null) ?? null)
      orgaoJulgador = orgaoJulgador ?? ((pub.orgao_julgador as string | null) ?? null)
      const texto = extrairTextoPlano(pub.texto as string | null)
      inteiroTeor = texto || null
      const d = pub.data_disponibilizacao as string | null
      publicacaoData = d ? String(d).slice(0, 10) : null
      numeroMascara = (pub.numero_mascara as string | null) ?? null
      // Só aproveita o resumo se o cache for da VERSÃO atual (payload antigo ⇒ null).
      if (cacheAtual(pub.sugestoes_ia)) {
        const r = (pub.sugestoes_ia as SugestoesIA).resumo?.trim()
        sugestoesResumo = r || null
      }
    }
  }

  return { classe, orgaoJulgador, assuntos, inteiroTeor, publicacaoData, numeroMascara, sugestoesResumo }
}

type AuthUsuario = { id: string; tenant_id: string }

const AREA_IDS = Object.keys(AREAS) as [AreaId, ...AreaId[]]
const schemaIA = z.object({ area: z.enum(AREA_IDS) })

const SYSTEM_INFERIR_AREA = `Você classifica UM processo/publicação jurídica em exatamente UMA área do Direito, pela classe processual, órgão julgador e teor.
Responda só com {"area":"<id>"} onde <id> é EXATAMENTE um destes: ${AREA_IDS.join(', ')}.`

/** Promise com corte de tempo: rejeita após `ms` (o fallback 'baixa' assume). */
function comTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timeout')), ms)
    p.then(
      (v) => { clearTimeout(t); resolve(v) },
      (e) => { clearTimeout(t); reject(e) },
    )
  })
}

/**
 * Fallback de IA (SÓ quando a regra determinística ficou 'baixa'). 1 chamada com
 * classe + órgão + inteiro teor curto pedindo a área dentre os ids válidos. Passa
 * pela cota/uso ('inferir_area') e por timeout curto; qualquer falha → 'baixa'
 * (a UI pede a escolha). Nunca decide sozinha o caso — só sugere a área.
 */
export async function inferirAreaComIA(
  supabase: Db,
  usuario: AuthUsuario,
  sinais: Pick<SinaisCaso, 'classe' | 'orgaoJulgador' | 'inteiroTeor'>,
): Promise<AreaInferida> {
  const cota = await verificarCota(supabase, usuario.tenant_id, 'inferir_area')
  if (!cota.permitido) return { area: 'civel', confianca: 'baixa' }

  const teor = (sinais.inteiroTeor ?? '').slice(0, TEOR_MAX_CHARS)
  const prompt = [
    `Classe: ${sinais.classe ?? '—'}`,
    `Órgão julgador: ${sinais.orgaoJulgador ?? '—'}`,
    teor ? `Teor (trecho): ${teor}` : 'Teor: —',
  ].join('\n')

  const start = Date.now()
  try {
    const { result, usage } = await comTimeout(
      completionJSON<{ area: AreaId }>({
        system: SYSTEM_INFERIR_AREA,
        prompt,
        model: DEFAULT_MODEL,
        maxTokens: IA_MAX_TOKENS,
        schema: schemaIA,
      }),
      IA_TIMEOUT_MS,
    )
    await logUsage({
      tenantId: usuario.tenant_id,
      userId: usuario.id,
      endpoint: 'inferir_area',
      modelo: DEFAULT_MODEL,
      tokensInput: usage.input,
      tokensOutput: usage.output,
      latenciaMs: Date.now() - start,
    })
    return { area: result.area, confianca: 'alta' }
  } catch (err) {
    // LGPD: só tamanhos, nunca o teor.
    logger.error('tarefa.inferir_area.ia_falha', { teorLen: teor.length }, err)
    return { area: 'civel', confianca: 'baixa' }
  }
}

/**
 * Resolve a área do caso a criar por precedência:
 *   1) escolha explícita do usuário (areaEscolhida) — sempre 'alta';
 *   2) regra determinística sobre os sinais;
 *   3) fallback de IA quando a regra ficou 'baixa' (só então gasta cota).
 * Devolve a área + a confiança + a via (para auditoria/telemetria sem PII).
 */
export async function resolverAreaDoCaso(
  supabase: Db,
  usuario: AuthUsuario,
  sinais: SinaisCaso,
  areaEscolhida: AreaId | null,
): Promise<AreaInferida & { via: 'usuario' | 'regra' | 'ia' }> {
  if (areaEscolhida) return { area: areaEscolhida, confianca: 'alta', via: 'usuario' }

  const determinada = inferirAreaDoProcesso(sinais)
  if (determinada.confianca === 'alta') return { ...determinada, via: 'regra' }

  const ia = await inferirAreaComIA(supabase, usuario, sinais)
  return { ...ia, via: 'ia' }
}
