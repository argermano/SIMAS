import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { d4signDownloadDocument } from '@/lib/d4sign/client'
import type { D4SignWebhookPayload } from '@/lib/d4sign/types'

const D4SIGN_STATUS_MAP: Record<string, string> = {
  '1': 'uploaded',
  '2': 'waiting_signatures',
  '3': 'waiting_signatures',
  '4': 'download_ready',
  '5': 'completed',
  '6': 'cancelled',
}

// POST /api/webhooks/d4sign  (público — chamado pela D4Sign)
export async function POST(req: NextRequest) {
  let payload: D4SignWebhookPayload
  try {
    payload = await req.json()
  } catch {
    return NextResponse.json({ error: 'Payload inválido' }, { status: 400 })
  }

  const { uuid, status } = payload
  if (!uuid || !status) return NextResponse.json({ ok: true })

  // Usar service role para acesso sem contexto de usuário
  const supabase = await createClient()

  const { data: signature } = await supabase
    .from('contract_signatures')
    .select('id, status, tenant_id, created_by')
    .eq('d4sign_uuid', uuid)
    .maybeSingle()

  if (!signature) return NextResponse.json({ ok: true }) // documento desconhecido — ignorar

  const novoStatus = D4SIGN_STATUS_MAP[status]
  if (!novoStatus) return NextResponse.json({ ok: true })

  // Idempotência
  if (signature.status === novoStatus) return NextResponse.json({ ok: true })

  const update: Record<string, unknown> = { status: novoStatus }

  // Documento finalizado — baixar e salvar URL
  if (status === '4') {
    try {
      const downloadUrl = await d4signDownloadDocument(uuid)
      if (downloadUrl) update.signed_file_url = downloadUrl
      update.completed_at = new Date().toISOString()
    } catch { /* silencioso — atualiza status mesmo se download falhar */ }

    // Concluir tarefa automática vinculada
    try {
      const originRef = `d4sign_signature:${signature.id}`
      const { data: task } = await supabase
        .from('tasks')
        .select('id')
        .eq('origin_reference', originRef)
        .eq('tenant_id', signature.tenant_id)
        .maybeSingle()
      if (task) {
        await supabase
          .from('tasks')
          .update({ completed_at: new Date().toISOString() })
          .eq('id', task.id)
      }
    } catch { /* silencioso */ }
  }

  if (status === '6') {
    update.cancelled_at = new Date().toISOString()
  }

  // Atualizar signatários se finalizou (status "4")
  if (status === '4') {
    // Marcar todos como assinados (não temos detalhe por signatário via webhook genérico)
    await supabase
      .from('contract_signature_signers')
      .update({ signed: true, signed_at: new Date().toISOString() })
      .eq('signature_id', signature.id)
      .eq('signed', false)
  }

  await supabase
    .from('contract_signatures')
    .update(update)
    .eq('id', signature.id)

  return NextResponse.json({ ok: true })
}
