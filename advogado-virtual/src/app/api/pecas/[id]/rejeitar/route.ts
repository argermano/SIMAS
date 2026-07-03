import { NextRequest, NextResponse } from 'next/server'
import { getAuthContext } from '@/lib/auth'
import { jsonError, validateBody } from '@/lib/api'
import { z } from 'zod'
import { enviarEmailPecaRejeitada, urlBaseApp } from '@/lib/email'
import { TIPOS_PECA } from '@/lib/constants/tipos-peca'
import { LABELS_AREA } from '@/types'

const ROLES_REVISORES = ['admin', 'advogado']

function descreverPeca(tipo: string, area: string): string {
  const nomeTipo = TIPOS_PECA[tipo]?.nome ?? tipo
  const nomeArea = LABELS_AREA[area as keyof typeof LABELS_AREA] ?? area
  return `${nomeTipo} (${nomeArea})`
}

const schema = z.object({
  motivo: z.string().min(1, 'Motivo é obrigatório'),
})

// POST /api/pecas/[id]/rejeitar — rejeita peça em fila de revisão
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const auth = await getAuthContext()
  if (!auth.ok) return auth.response
  const { supabase, usuario } = auth

  if (!ROLES_REVISORES.includes(usuario.role)) {
    return jsonError('Sem permissão para rejeitar peças', 403)
  }

  const parsed = await validateBody(req, schema)
  if (!parsed.ok) return parsed.response

  const { data: peca, error } = await supabase
    .from('pecas')
    .update({
      status:           'rejeitada',
      revisado_por:     usuario.id,
      revisado_at:      new Date().toISOString(),
      motivo_rejeicao:  parsed.data.motivo,
    })
    .eq('id', id)
    .eq('tenant_id', usuario.tenant_id)
    .eq('status', 'aguardando_revisao')
    .select('id, status, area, tipo, autor:users!pecas_created_by_fkey(nome, email), atendimentos(clientes(nome))')
    .single()

  if (error || !peca) {
    return jsonError('Peça não encontrada ou não está aguardando revisão', 404)
  }

  // Notifica o autor com o motivo — sem isso, o colaborador não sabe que a peça
  // voltou nem por quê. Best-effort, não bloqueia o resultado.
  const autor = peca.autor as unknown as { nome?: string; email?: string } | null
  const cliente = (peca.atendimentos as unknown as { clientes?: { nome?: string } | null } | null)?.clientes?.nome ?? null
  let emailNotificado = false
  if (autor?.email) {
    emailNotificado = await enviarEmailPecaRejeitada({
      para: autor.email,
      nomeAutor: autor.nome ?? 'colega',
      descricaoPeca: descreverPeca(peca.tipo, peca.area),
      cliente,
      motivo: parsed.data.motivo,
      pecaUrl: `${urlBaseApp()}/${peca.area}/editor/${id}`,
    })
  }

  return NextResponse.json({ ok: true, peca: { id: peca.id, status: peca.status }, emailNotificado })
}
