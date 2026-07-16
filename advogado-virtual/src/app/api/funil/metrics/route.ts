import { NextResponse } from 'next/server'
import { getAuthContext, requireRole } from '@/lib/auth'
import { ORDEM_ETAPAS, type EtapaFunil } from '@/lib/funil/regras'

// GET /api/funil/metrics?periodo=30 — resumo do funil no período (7/30/90 dias).
// Sessão + admin/advogado. Cálculo em JS (volume do piloto é pequeno).
export async function GET(req: Request) {
  const auth = await getAuthContext()
  if (!auth.ok) return auth.response
  const { supabase, usuario } = auth
  const semRole = requireRole(usuario, ['admin'])
  if (semRole) return semRole

  const periodo = Math.min(365, Math.max(1, Number(new URL(req.url).searchParams.get('periodo')) || 30))
  const desde = new Date(Date.now() - periodo * 86_400_000).toISOString()

  const { data: leads } = await supabase
    .from('funil_leads')
    .select('id, etapa, valor_estimado, area, unidade, motivo_perda, created_at')
    .eq('tenant_id', usuario.tenant_id)
    .gte('created_at', desde)

  const linhas = leads ?? []
  const ids = linhas.map((l) => l.id)

  // Eventos das leads do período — para tempo médio por etapa.
  let eventos: { lead_id: string; para_etapa: string; created_at: string }[] = []
  if (ids.length) {
    const { data } = await supabase
      .from('funil_lead_eventos')
      .select('lead_id, para_etapa, created_at')
      .in('lead_id', ids)
      .order('created_at', { ascending: true })
    eventos = data ?? []
  }

  // 1) Por etapa: contagem + soma de valor.
  const porEtapa = [...ORDEM_ETAPAS, 'perdido' as EtapaFunil].map((etapa) => {
    const doGrupo = linhas.filter((l) => l.etapa === etapa)
    return {
      etapa,
      count: doGrupo.length,
      valor: doGrupo.reduce((s, l) => s + (Number(l.valor_estimado) || 0), 0),
    }
  })

  // 2) Conversão.
  const total = linhas.length
  const fechados = linhas.filter((l) => l.etapa === 'contrato_fechado').length
  const perdidos = linhas.filter((l) => l.etapa === 'perdido').length
  const decididos = fechados + perdidos
  const conversao = {
    total,
    fechados,
    perdidos,
    emAndamento: total - decididos,
    taxaFechamento: total ? Math.round((fechados / total) * 1000) / 10 : 0,       // % sobre todos
    taxaGanhoDecididos: decididos ? Math.round((fechados / decididos) * 1000) / 10 : 0, // % ganho/decididos
  }

  // 3) Motivos de perda.
  const motivosMap = new Map<string, number>()
  for (const l of linhas) if (l.etapa === 'perdido' && l.motivo_perda) motivosMap.set(l.motivo_perda, (motivosMap.get(l.motivo_perda) ?? 0) + 1)
  const motivosPerda = [...motivosMap.entries()].map(([motivo, count]) => ({ motivo, count })).sort((a, b) => b.count - a.count)

  // 4) Quebras por área e unidade.
  const quebra = (campo: 'area' | 'unidade') => {
    const m = new Map<string, { count: number; fechados: number; valor: number }>()
    for (const l of linhas) {
      const k = (l[campo] as string) || '—'
      const acc = m.get(k) ?? { count: 0, fechados: 0, valor: 0 }
      acc.count++
      if (l.etapa === 'contrato_fechado') { acc.fechados++; acc.valor += Number(l.valor_estimado) || 0 }
      m.set(k, acc)
    }
    return [...m.entries()].map(([chave, v]) => ({ chave, ...v })).sort((a, b) => b.count - a.count)
  }

  // 5) Tempo médio por etapa (dias) — via intervalos entre eventos consecutivos da mesma lead.
  const soma = new Map<string, { totalMs: number; n: number }>()
  const porLead = new Map<string, { para_etapa: string; created_at: string }[]>()
  for (const e of eventos) {
    const arr = porLead.get(e.lead_id) ?? []
    arr.push(e)
    porLead.set(e.lead_id, arr)
  }
  for (const arr of porLead.values()) {
    for (let i = 0; i < arr.length - 1; i++) {
      const etapa = arr[i].para_etapa
      const ms = new Date(arr[i + 1].created_at).getTime() - new Date(arr[i].created_at).getTime()
      if (ms < 0) continue
      const acc = soma.get(etapa) ?? { totalMs: 0, n: 0 }
      acc.totalMs += ms; acc.n++
      soma.set(etapa, acc)
    }
  }
  const tempoMedioPorEtapa = [...ORDEM_ETAPAS].map((etapa) => {
    const acc = soma.get(etapa)
    return { etapa, dias: acc && acc.n ? Math.round((acc.totalMs / acc.n / 86_400_000) * 10) / 10 : null }
  })

  return NextResponse.json({
    periodo,
    porEtapa,
    conversao,
    motivosPerda,
    porArea: quebra('area'),
    porUnidade: quebra('unidade'),
    tempoMedioPorEtapa,
  })
}
