// Reparo de resumos IA (resumo_ia NULL) — movimentos ficam sem resumo quando a
// chamada Haiku falha no sync (best-effort) ou quando vêm de um backfill em
// massa. Recentes primeiro (data_hora desc) — são os que o cliente vê.
// Idempotente: só toca linhas com resumo_ia IS NULL e atualiza SOMENTE
// resumo_ia, nunca notif_*/categoria. Publicações do DJEN entram como qualquer
// outro movimento sem resumo.
//
// Plano Hobby da Vercel: sem cron próprio (limite de 2 crons, só diários) —
// esta função roda na FOLGA do cron diário funil-consultas e também pela rota
// /api/cron/reparar-resumos (disparo manual com CRON_SECRET).

import type { SupabaseClient } from '@supabase/supabase-js'
import { logger } from '@/lib/logger'
import { gerarResumos } from '@/lib/processos/sync'

const CHUNK = 30 // mesmo lote do sync (uma chamada Haiku por chunk)
const PAGINA = 500 // candidatos por página; refetch enquanto houver orçamento de tempo

export interface ReparoResultado {
  reparados: number
  restantes: number
}

/** Preenche resumo_ia dos movimentos que estão NULL até `deadline` (epoch ms).
 *  O que não couber fica para a próxima execução. Nunca lança. */
export async function repararResumos(
  admin: SupabaseClient,
  opts: { deadline: number },
): Promise<ReparoResultado> {
  const { deadline } = opts
  const tentados = new Set<string>() // IDs já tentados neste run → não reprocessa falhas e garante avanço/término
  let reparados = 0
  let achouAlgum = false

  try {
    while (Date.now() < deadline) {
      const { data: pagina, error } = await admin
        .from('processo_movimentos')
        .select('id, nome, complementos')
        .is('resumo_ia', null)
        .order('data_hora', { ascending: false, nullsFirst: false })
        .limit(PAGINA)
      if (error) {
        logger.error('processos.reparo.listar', {}, error)
        break
      }
      // Falhas deste run seguem NULL e voltariam na próxima página; o Set as
      // descarta, então cada página revela linhas ainda não tentadas.
      const pend = (pagina ?? []).filter((r) => !tentados.has(r.id as string))
      if (pend.length === 0) break // nada a reparar (no-op rápido) ou só sobraram falhas já tentadas
      achouAlgum = true

      for (let i = 0; i < pend.length && Date.now() < deadline; i += CHUNK) {
        const slice = pend.slice(i, i + CHUNK)
        const resumos = await gerarResumos(
          slice.map((r) => ({
            nome: r.nome as string,
            complementos: r.complementos as Array<Record<string, unknown>>,
          })),
        )
        await Promise.all(
          slice.map(async (r, j) => {
            const id = r.id as string
            tentados.add(id)
            const resumo = resumos[j]
            if (!resumo) return // chunk falhou para este item — fica para a próxima execução
            // Guard IS NULL: idempotente e nunca regenera um resumo já existente.
            const { error: upErr } = await admin
              .from('processo_movimentos')
              .update({ resumo_ia: resumo })
              .eq('id', id)
              .is('resumo_ia', null)
            if (!upErr) reparados++
          }),
        )
      }
    }
  } catch (e) {
    // Best-effort: reparo nunca derruba quem o chamou (cron diário).
    logger.error('processos.reparo.excecao', {}, e as Error)
  }

  // Restantes reais (falhas deste run + o que não coube). Contagem barata só se
  // houve trabalho; no no-op não sobra nada e evitamos até essa consulta.
  let restantes = 0
  if (achouAlgum) {
    const { count } = await admin
      .from('processo_movimentos')
      .select('id', { count: 'exact', head: true })
      .is('resumo_ia', null)
    restantes = count ?? 0
  }

  logger.info('processos.reparo', { reparados, restantes }) // LGPD: só contagens
  return { reparados, restantes }
}
