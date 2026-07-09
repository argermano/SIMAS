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
  ] = await Promise.all([
    // Total de publicações ainda por triar (status 'nova') = naoTratadasTotal.
    supabase
      .from('publicacoes')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', usuario.tenant_id)
      .eq('status', 'nova'),
    // Últimas 6 rodadas (por OAB), mais recentes primeiro.
    supabase
      .from('capturas_publicacoes')
      .select('oab, uf, status, qtd_encontradas, qtd_novas, finalizada_em')
      .eq('tenant_id', usuario.tenant_id)
      .order('created_at', { ascending: false })
      .limit(6),
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
  ])

  const ultimaSucessoEm =
    (sucessoRes.data?.[0]?.finalizada_em as string | null | undefined) ?? null

  const naoTratadasTotal = novasRes.count ?? 0

  return NextResponse.json({
    novas:   naoTratadasTotal,
    ultimas: (ultimasRes.data ?? []) as unknown as UltimaCaptura[],
    ultimaSucessoEm,
    contadores: {
      naoTratadasHoje:  naoTratadasHojeRes.count ?? 0,
      tratadasHoje:     tratadasHojeRes.count ?? 0,
      descartadasHoje:  descartadasHojeRes.count ?? 0,
      naoTratadasTotal,
    },
  })
}
