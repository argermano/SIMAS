import { NextResponse } from 'next/server'
import { z } from 'zod'
import { getAuthContext, requireRole } from '@/lib/auth'
import { jsonError, validateBody } from '@/lib/api'
import { logAudit } from '@/lib/audit'
import { logger } from '@/lib/logger'

// ─────────────────────────────────────────────────────────────
// POST /api/publicacoes/sentinela/[id] — ação humana sobre um alerta da
// sentinela (admin/advogado):
//  - 'verificada' → o advogado conferiu o expediente no PJe.
//  - 'ignorada'   → falso positivo / não interessa.
//
// CLAIM ATÔMICO (lição da Fase 5): UPDATE ... WHERE status='aberta' RETURNING.
// Zero linhas ⇒ outra pessoa (ou a auto-resolução da rodada) já resolveu (409)
// ou o alerta não existe (404). Grava resolvida_por/resolvida_em e logAudit.
// A sentinela NUNCA notifica cliente e NUNCA calcula prazo.
// ─────────────────────────────────────────────────────────────

const schema = z.object({
  acao: z.enum(['verificada', 'ignorada']),
})

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await getAuthContext()
  if (!auth.ok) return auth.response
  const { supabase, usuario } = auth
  const gate = requireRole(usuario, ['admin', 'advogado'])
  if (gate) return gate

  const { id } = await params
  // id malformado (não-UUID) daria erro de cast 22P02 no Postgres → 500 com
  // log de erro; semanticamente é um alerta que não existe.
  if (!z.string().uuid().safeParse(id).success) return jsonError('Alerta não encontrado.', 404)

  const parsed = await validateBody(req, schema)
  if (!parsed.ok) return parsed.response
  const { acao } = parsed.data

  const { data: claim, error } = await supabase
    .from('sentinela_publicacoes')
    .update({
      status: acao,
      resolvida_por: usuario.id,
      resolvida_em: new Date().toISOString(),
    })
    .eq('id', id)
    .eq('tenant_id', usuario.tenant_id)
    .eq('status', 'aberta') // claim atômico: só resolve alerta ainda aberto
    .select('id')

  if (error) {
    logger.error('sentinela.resolver.falha', { alertaId: id, acao }, error)
    return jsonError('Falha ao resolver o alerta.', 500)
  }
  if (!claim || claim.length === 0) {
    // Distingue "não existe" (404) de "já resolvido" (409) com leitura pontual.
    const { data: existe } = await supabase
      .from('sentinela_publicacoes')
      .select('id')
      .eq('id', id)
      .eq('tenant_id', usuario.tenant_id)
      .maybeSingle()
    if (!existe) return jsonError('Alerta não encontrado.', 404)
    return jsonError('Este alerta já foi resolvido.', 409)
  }

  await logAudit({
    tenantId: usuario.tenant_id,
    userId: usuario.id,
    action: acao === 'verificada' ? 'sentinela.verificada' : 'sentinela.ignorada',
    resourceType: 'sentinela_publicacao',
    resourceId: id,
  })

  return NextResponse.json({ ok: true, status: acao })
}
