import { NextResponse } from 'next/server'
import { getAuthContext } from '@/lib/auth'
import { jsonError } from '@/lib/api'
import { logAudit } from '@/lib/audit'

// PATCH /api/documentos/[docId]/vinculo — vincula um documento do cliente a um
// CASO (atendimento_id) OU a um PROCESSO (processo_id), ou o DESVINCULA (volta a
// geral). O vínculo específico é no máximo UM (o CHECK 061 também garante).
// Segurança: o alvo (caso/processo) precisa ser do MESMO cliente e tenant do
// documento — senão 403. O doc precisa ter cliente_id (dono no dossiê).
// LGPD: auditoria só com ids/contagens, nunca nomes de arquivo.
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ docId: string }> },
) {
  const { docId } = await params
  const auth = await getAuthContext()
  if (!auth.ok) return auth.response
  const { supabase, usuario } = auth

  const body = (await req.json().catch(() => null)) as
    | { atendimento_id?: string | null; processo_id?: string | null; desvincular?: boolean }
    | null
  if (!body) return jsonError('Corpo da requisição inválido', 400)

  const { data: doc } = await supabase
    .from('documentos')
    .select('id, cliente_id, atendimento_id, processo_id')
    .eq('id', docId)
    .eq('tenant_id', usuario.tenant_id)
    .single()
  if (!doc) return jsonError('Documento não encontrado', 404)
  // O vínculo se apoia na posse do doc pelo cliente (dono no dossiê).
  if (!doc.cliente_id) return jsonError('Documento sem cliente — não é possível vincular.', 400)

  // ── Desvincular: volta a geral (limpa ambos) ──────────────────────────────
  if (body.desvincular === true) {
    const { error } = await supabase
      .from('documentos')
      .update({ atendimento_id: null, processo_id: null })
      .eq('id', docId)
      .eq('tenant_id', usuario.tenant_id)
    if (error) return jsonError(error.message, 500)
    await logAudit({
      tenantId: usuario.tenant_id, userId: usuario.id,
      action: 'documento.desvincular', resourceType: 'documento', resourceId: docId,
      metadata: { cliente_id: doc.cliente_id },
    })
    return NextResponse.json({ ok: true, atendimento_id: null, processo_id: null })
  }

  // ── Vincular a um CASO (atendimento) ──────────────────────────────────────
  if (typeof body.atendimento_id === 'string' && body.atendimento_id) {
    const alvoId = body.atendimento_id
    const { data: alvo } = await supabase
      .from('atendimentos')
      .select('id, cliente_id')
      .eq('id', alvoId)
      .eq('tenant_id', usuario.tenant_id)
      .is('deleted_at', null)
      .single()
    if (!alvo) return jsonError('Caso não encontrado', 404)
    if (alvo.cliente_id !== doc.cliente_id) return jsonError('O caso pertence a outro cliente.', 403)

    const { error } = await supabase
      .from('documentos')
      .update({ atendimento_id: alvoId, processo_id: null })
      .eq('id', docId)
      .eq('tenant_id', usuario.tenant_id)
    if (error) return jsonError(error.message, 500)
    await logAudit({
      tenantId: usuario.tenant_id, userId: usuario.id,
      action: 'documento.vincular', resourceType: 'documento', resourceId: docId,
      metadata: { cliente_id: doc.cliente_id, atendimento_id: alvoId },
    })
    return NextResponse.json({ ok: true, atendimento_id: alvoId, processo_id: null })
  }

  // ── Vincular a um PROCESSO ────────────────────────────────────────────────
  if (typeof body.processo_id === 'string' && body.processo_id) {
    const alvoId = body.processo_id
    const { data: alvo } = await supabase
      .from('processos')
      .select('id, cliente_id')
      .eq('id', alvoId)
      .eq('tenant_id', usuario.tenant_id)
      .single()
    if (!alvo) return jsonError('Processo não encontrado', 404)
    if (alvo.cliente_id !== doc.cliente_id) return jsonError('O processo pertence a outro cliente.', 403)

    const { error } = await supabase
      .from('documentos')
      .update({ processo_id: alvoId, atendimento_id: null })
      .eq('id', docId)
      .eq('tenant_id', usuario.tenant_id)
    if (error) return jsonError(error.message, 500)
    await logAudit({
      tenantId: usuario.tenant_id, userId: usuario.id,
      action: 'documento.vincular', resourceType: 'documento', resourceId: docId,
      metadata: { cliente_id: doc.cliente_id, processo_id: alvoId },
    })
    return NextResponse.json({ ok: true, atendimento_id: null, processo_id: alvoId })
  }

  return jsonError('Informe atendimento_id, processo_id ou desvincular.', 400)
}
