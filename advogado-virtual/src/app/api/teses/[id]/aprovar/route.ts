import { NextResponse } from 'next/server'
import { getAuthContext } from '@/lib/auth'
import { jsonError } from '@/lib/api'
import { logAudit } from '@/lib/audit'
import { AREAS, type AreaId } from '@/lib/constants/areas'

// POST /api/teses/[id]/aprovar — aprova uma sugestão de tese (com edições).
// A partir daqui ela fundamenta a geração de peças da área. Só admin/advogado.
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const auth = await getAuthContext()
  if (!auth.ok) return auth.response
  const { supabase, usuario } = auth

  if (!(usuario.role === 'admin' || usuario.role === 'advogado')) {
    return jsonError('Sem permissão para aprovar teses', 403)
  }

  const body = (await req.json().catch(() => ({}))) as {
    tese?: string; area?: string; dispositivos?: string[]; sumulas?: string[]
    quando_usar?: string; confirmada?: boolean
  }

  // Campos editáveis na aprovação (o advogado lapida antes de aprovar).
  const patch: Record<string, unknown> = {
    status: 'aprovada',
    aprovada_por: usuario.id,
    aprovada_em: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }
  if (typeof body.tese === 'string' && body.tese.trim()) patch.tese = body.tese.trim()
  if (body.area && AREAS[body.area as AreaId]) patch.area = body.area
  if (Array.isArray(body.dispositivos)) patch.dispositivos = body.dispositivos.filter(Boolean)
  if (Array.isArray(body.sumulas)) patch.sumulas = body.sumulas.filter(Boolean)
  if (body.quando_usar !== undefined) patch.quando_usar = body.quando_usar?.trim() || null

  const { data: tese, error } = await supabase
    .from('teses_escritorio')
    .update(patch)
    .eq('id', id)
    .eq('tenant_id', usuario.tenant_id)
    .eq('status', 'sugerida')
    .select('id, area, tese')
    .single()

  if (error || !tese) return jsonError('Tese não encontrada ou já processada', 404)

  await logAudit({
    tenantId: usuario.tenant_id,
    userId: usuario.id,
    action: 'tese.aprovar',
    resourceType: 'tese',
    resourceId: id,
    metadata: { area: tese.area, confirmadaConferencia: !!body.confirmada },
  })

  return NextResponse.json({ ok: true, tese })
}
