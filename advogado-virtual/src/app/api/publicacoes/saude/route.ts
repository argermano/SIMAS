import { NextResponse } from 'next/server'
import { getAuthContext } from '@/lib/auth'

// ─────────────────────────────────────────────────────────────
// GET /api/publicacoes/saude — widget de saúde da captura (Lote 2)
// Contagem de publicações 'nova', as últimas 6 rodadas de captura do tenant e o
// timestamp da última captura bem-sucedida. Tudo escopado ao tenant (RLS + eq).
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

  const [novasRes, ultimasRes, sucessoRes] = await Promise.all([
    // Total de publicações ainda por triar (status 'nova').
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
  ])

  const ultimaSucessoEm =
    (sucessoRes.data?.[0]?.finalizada_em as string | null | undefined) ?? null

  return NextResponse.json({
    novas:   novasRes.count ?? 0,
    ultimas: (ultimasRes.data ?? []) as unknown as UltimaCaptura[],
    ultimaSucessoEm,
  })
}
