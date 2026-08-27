import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getAuthContext } from '@/lib/auth'
import { jsonError, validateBody } from '@/lib/api'
import { logger } from '@/lib/logger'
import { PatchSecaoError } from '@/lib/diff/patch-secoes'
import { decidirProposta, DecisaoError } from '@/lib/ia/sessao/decidir'
import {
  adminSessoes,
  carregarPecaDoTenant,
  carregarProposta,
  carregarSessao,
} from '@/lib/ia/sessao/sessoes'

export const maxDuration = 60

const schema = z
  .object({
    decisoes: z
      .array(z.object({ titulo: z.string(), decisao: z.enum(['aceitar', 'rejeitar']) }))
      .optional(),
    aceitarTudo: z.boolean().optional(),
    rejeitarTudo: z.boolean().optional(),
    /** Confirma por cima do aviso "a peça mudou" ou "conteúdo menor". */
    forcar: z.boolean().optional(),
  })
  .refine(
    (d) => d.aceitarTudo || d.rejeitarTudo || (d.decisoes && d.decisoes.length > 0),
    'Informe as decisões por seção, ou aceitarTudo/rejeitarTudo.',
  )

// POST /api/pecas/[id]/sessao/[sid]/propostas/[pid]/decidir
//
// O ÚNICO caminho em que a sessão altera a peça — e só com o aceite explícito
// do advogado, seção por seção. Ver src/lib/ia/sessao/decidir.ts.
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; sid: string; pid: string }> },
) {
  const { id: pecaId, sid, pid } = await params

  const auth = await getAuthContext()
  if (!auth.ok) return auth.response
  const { supabase, usuario } = auth

  const parsed = await validateBody(req, schema)
  if (!parsed.ok) return parsed.response

  const peca = await carregarPecaDoTenant(supabase, pecaId, usuario.tenant_id)
  if (!peca) return jsonError('Peça não encontrada', 404)

  const admin = adminSessoes()
  const sessao = await carregarSessao(admin, { sessaoId: sid, pecaId, tenantId: usuario.tenant_id })
  if (!sessao) return jsonError('Sessão não encontrada', 404)

  const proposta = await carregarProposta(admin, { propostaId: pid, sessaoId: sid })
  if (!proposta) return jsonError('Proposta não encontrada', 404)

  try {
    const resultado = await decidirProposta({
      supabase,
      admin,
      tenantId: usuario.tenant_id,
      usuarioId: usuario.id,
      peca,
      sessao,
      proposta,
      entrada: parsed.data,
    })
    return NextResponse.json({ ok: true, ...resultado })
  } catch (err) {
    if (err instanceof DecisaoError) {
      return jsonError(err.message, err.status, err.detalhes)
    }
    if (err instanceof PatchSecaoError) {
      // A seção citada pela proposta sumiu da peça (edição manual no meio).
      return jsonError(err.message, err.status, {
        code: 'SECAO_INEXISTENTE',
        titulo: err.titulo,
        acao: err.acao,
        disponiveis: err.disponiveis,
      })
    }
    logger.error('ia.sessao.decidir.falha', { pecaId, sessaoId: sid, propostaId: pid }, err)
    return jsonError('Não foi possível aplicar a decisão', 500)
  }
}
