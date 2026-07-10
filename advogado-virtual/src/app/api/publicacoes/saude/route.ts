import { NextResponse } from 'next/server'
import { getAuthContext } from '@/lib/auth'
import { hojeSaoPauloISO } from '@/lib/processos/util'

// ─────────────────────────────────────────────────────────────
// GET /api/publicacoes/saude — widget de saúde da captura (Lote 2)
// Contagem de publicações 'nova', as últimas 6 rodadas de captura do tenant e o
// timestamp da última captura bem-sucedida. Tudo escopado ao tenant (RLS + eq).
//
// TRATAMENTO (incremento estação-de-tratamento): devolve também `contadores`
// para o topo da tela — não tratadas/tratadas/descartadas de HOJE (fuso
// America/Sao_Paulo) e o total pendente. Tudo com count exact + head:true
// (só o número, sem trafegar linhas).
// ─────────────────────────────────────────────────────────────

interface UltimaCaptura {
  oab: string
  uf: string
  status: string
  qtd_encontradas: number
  qtd_novas: number
  finalizada_em: string | null
}

// Chip por OAB no topo da caixa: "{oab}/{uf} · {novas} novas de {total}".
interface OabResumo {
  oab: string
  uf: string
  novas: number
  total: number
}

// Colunas leves p/ agregar o resumo por OAB (nunca puxa texto/meta).
interface LinhaOab {
  oab_consultada: string
  uf_oab: string
  status: string
  data_disponibilizacao: string
}

export async function GET() {
  const auth = await getAuthContext()
  if (!auth.ok) return auth.response
  const { supabase, usuario } = auth

  // Janela "hoje" em São Paulo. `data_disponibilizacao` é DATE → compara com a
  // string ISO do dia. `triada_em` é TIMESTAMPTZ → compara na janela
  // [hoje 00:00, amanhã 00:00) ancorada no offset de SP. O Brasil não observa
  // horário de verão desde 2019, então o offset é fixo -03:00.
  const hoje = hojeSaoPauloISO()
  const [ano, mes, dia] = hoje.split('-').map(Number)
  const amanha = new Date(Date.UTC(ano, mes - 1, dia + 1)).toISOString().slice(0, 10)
  const inicioHoje = `${hoje}T00:00:00-03:00`
  const fimHoje = `${amanha}T00:00:00-03:00`

  const [
    novasRes,
    ultimasRes,
    sucessoRes,
    naoTratadasHojeRes,
    tratadasHojeRes,
    descartadasHojeRes,
    porOabRes,
  ] = await Promise.all([
    // Total de publicações ainda por triar (status 'nova') = naoTratadasTotal.
    supabase
      .from('publicacoes')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', usuario.tenant_id)
      .eq('status', 'nova'),
    // Últimas rodadas (mais recentes primeiro). Janela de 20 p/ garantir que a
    // rodada MAIS RECENTE de CADA OAB monitorada esteja presente (alerta abaixo);
    // o widget continua exibindo só as 6 primeiras.
    supabase
      .from('capturas_publicacoes')
      .select('oab, uf, status, qtd_encontradas, qtd_novas, finalizada_em, erro')
      .eq('tenant_id', usuario.tenant_id)
      .order('created_at', { ascending: false })
      .limit(20),
    // Última captura bem-sucedida (p/ marcar o widget de vermelho quando atrasada).
    supabase
      .from('capturas_publicacoes')
      .select('finalizada_em')
      .eq('tenant_id', usuario.tenant_id)
      .eq('status', 'sucesso')
      .not('finalizada_em', 'is', null)
      .order('finalizada_em', { ascending: false })
      .limit(1),
    // Não tratadas de hoje: 'nova' disponibilizadas hoje (SP).
    supabase
      .from('publicacoes')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', usuario.tenant_id)
      .eq('status', 'nova')
      .eq('data_disponibilizacao', hoje),
    // Tratadas de hoje: 'triada'/'tarefa_criada' com triada_em na janela de hoje (SP).
    supabase
      .from('publicacoes')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', usuario.tenant_id)
      .in('status', ['triada', 'tarefa_criada'])
      .gte('triada_em', inicioHoje)
      .lt('triada_em', fimHoje),
    // Descartadas de hoje: 'descartada' com triada_em na janela de hoje (SP).
    supabase
      .from('publicacoes')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', usuario.tenant_id)
      .eq('status', 'descartada')
      .gte('triada_em', inicioHoje)
      .lt('triada_em', fimHoje),
    // Resumo por OAB (chips do topo): colunas leves de TODAS as publicacoes do
    // tenant p/ agregar total e novas de hoje por inscrição. Escopo do piloto
    // (base pequena) — nunca puxa texto/meta.
    supabase
      .from('publicacoes')
      .select('oab_consultada, uf_oab, status, data_disponibilizacao')
      .eq('tenant_id', usuario.tenant_id),
  ])

  const ultimaSucessoEm =
    (sucessoRes.data?.[0]?.finalizada_em as string | null | undefined) ?? null

  const naoTratadasTotal = novasRes.count ?? 0

  // Agrega o resumo por OAB: só as inscrições PRESENTES na caixa (total ≥ 1). Um
  // registro só existe no map quando aparece → OABs sem publicação não viram chip.
  // `novas` = 'nova' disponibilizadas hoje (SP); `total` = todas da OAB no tenant.
  const porOabMap = new Map<string, OabResumo>()
  for (const r of (porOabRes.data ?? []) as unknown as LinhaOab[]) {
    const oab = r.oab_consultada
    const uf = r.uf_oab
    if (!oab) continue
    const chave = `${oab}:${uf}`
    let e = porOabMap.get(chave)
    if (!e) {
      e = { oab, uf, novas: 0, total: 0 }
      porOabMap.set(chave, e)
    }
    e.total++
    if (r.status === 'nova' && r.data_disponibilizacao === hoje) e.novas++
  }
  const porOab = [...porOabMap.values()].sort((a, b) => a.oab.localeCompare(b.oab))

  // ALERTAS de captura (pedido do dono, 2026-07-10 — período de comparação com o
  // Astrea): se a rodada MAIS RECENTE de alguma OAB terminou em 'falha', o usuário
  // precisa de ciência EXPLÍCITA ao entrar na tela — os diários podem estar
  // incompletos. (O sinal "26h sem sucesso" do widget não cobre a falha do dia:
  // o sucesso de ontem ainda segura o verde.) 'parcial' também alerta: cobertura
  // incompleta da janela.
  const capturas = (ultimasRes.data ?? []) as unknown as (UltimaCaptura & { erro?: string | null })[]
  const maisRecentePorOab = new Map<string, UltimaCaptura & { erro?: string | null }>()
  for (const c of capturas) {
    const chave = `${c.oab}:${c.uf}`
    if (!maisRecentePorOab.has(chave)) maisRecentePorOab.set(chave, c) // já vem desc
  }
  const alertas = [...maisRecentePorOab.values()]
    .filter((c) => c.status === 'falha' || c.status === 'parcial')
    .map((c) => ({
      oab: c.oab,
      uf: c.uf,
      status: c.status,
      erro: c.erro ?? null,
      quando: c.finalizada_em,
    }))
    .sort((a, b) => a.oab.localeCompare(b.oab))

  return NextResponse.json({
    novas:   naoTratadasTotal,
    ultimas: capturas.slice(0, 6).map(({ erro: _erro, ...c }) => c),
    ultimaSucessoEm,
    alertas,
    contadores: {
      naoTratadasHoje:  naoTratadasHojeRes.count ?? 0,
      tratadasHoje:     tratadasHojeRes.count ?? 0,
      descartadasHoje:  descartadasHojeRes.count ?? 0,
      naoTratadasTotal,
    },
    porOab,
  })
}
