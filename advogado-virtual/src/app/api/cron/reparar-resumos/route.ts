import { NextResponse } from 'next/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { logger } from '@/lib/logger'
import { gerarResumos } from '@/lib/processos/sync'

export const maxDuration = 300

const CHUNK = 30 // mesmo lote do sync (uma chamada Haiku por chunk)
const PAGINA = 500 // candidatos por página; refetch enquanto houver orçamento de tempo
const TETO_MS = 250_000 // teto desde t0 — o que sobrar fica para a próxima execução

// GET /api/cron/reparar-resumos — gera os resumo_ia que faltam. Movimentos ficam
// com resumo_ia NULL quando a chamada Haiku falha no sync (best-effort) ou quando
// vêm de um backfill em massa; este cron horário os preenche em produção, sem
// segredo manual. Recentes primeiro (data_hora desc) — são os que o cliente vê.
// Idempotente: só toca linhas com resumo_ia IS NULL e atualiza SOMENTE resumo_ia,
// nunca notif_*/categoria. Fail-closed por CRON_SECRET (a Vercel injeta o Bearer
// automaticamente nas invocações de cron; SEM fallback de sessão). Publicações do
// DJEN ('Publicação no DJEN…') entram como qualquer outro movimento sem resumo.
export async function GET(req: Request) {
  const t0 = Date.now()
  const secret = process.env.CRON_SECRET
  if (!secret || req.headers.get('authorization') !== `Bearer ${secret}`) {
    return new NextResponse('Unauthorized', { status: 401 })
  }

  const admin = createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )

  const deadline = t0 + TETO_MS
  const tentados = new Set<string>() // IDs já tentados neste run → não reprocessa falhas e garante avanço/término
  let reparados = 0
  let achouAlgum = false

  while (Date.now() < deadline) {
    const { data: pagina, error } = await admin
      .from('processo_movimentos')
      .select('id, nome, complementos')
      .is('resumo_ia', null)
      .order('data_hora', { ascending: false, nullsFirst: false })
      .limit(PAGINA)
    if (error) {
      logger.error('cron.reparar_resumos.listar', {}, error)
      return NextResponse.json({ erro: error.message }, { status: 500 })
    }
    // Falhas deste run seguem NULL e voltariam na próxima página; o Set as descarta,
    // então cada página revela linhas ainda não tentadas (avança até esvaziar).
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

  // Restantes reais (falhas deste run + o que não coube). Uma contagem barata só se
  // houve trabalho; no no-op não sobra nada e evitamos até essa consulta.
  let restantes = 0
  if (achouAlgum) {
    const { count } = await admin
      .from('processo_movimentos')
      .select('id', { count: 'exact', head: true })
      .is('resumo_ia', null)
    restantes = count ?? 0
  }

  logger.info('cron.reparar_resumos', { reparados, restantes }) // LGPD: só contagens
  return NextResponse.json({ ok: true, reparados, restantes })
}
