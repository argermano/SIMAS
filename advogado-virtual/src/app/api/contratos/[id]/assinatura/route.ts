import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { d4signGetStatus, d4signGetSigningLink, d4signCancelDocument } from '@/lib/d4sign/client'

const D4SIGN_STATUS_MAP: Record<string, string> = {
  '1': 'uploaded',
  '2': 'waiting_signatures',
  '3': 'waiting_signatures',
  '4': 'completed',
  '5': 'completed',
  '6': 'cancelled',
}

// GET /api/contratos/[id]/assinatura
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })

  const { data: usuario } = await supabase
    .from('users').select('tenant_id').eq('auth_user_id', user.id).single()
  if (!usuario) return NextResponse.json({ error: 'Não encontrado' }, { status: 404 })

  const { data: signature } = await supabase
    .from('contract_signatures')
    .select('*, contract_signature_signers(*)')
    .eq('contrato_id', id)
    .eq('tenant_id', usuario.tenant_id)
    .neq('status', 'cancelled')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (!signature) return NextResponse.json({ signature: null })

  // Atualizar links de assinatura para signatários pendentes
  if (signature.d4sign_uuid && signature.status === 'waiting_signatures') {
    const signers = signature.contract_signature_signers ?? []
    for (const signer of signers) {
      if (!signer.signed && !signer.signing_link) {
        try {
          const link = await d4signGetSigningLink(signature.d4sign_uuid, signer.email)
          if (link) {
            await supabase
              .from('contract_signature_signers')
              .update({ signing_link: link })
              .eq('id', signer.id)
            signer.signing_link = link
          }
        } catch { /* silencioso */ }
      }
    }
  }

  return NextResponse.json({ signature })
}

// PATCH /api/contratos/[id]/assinatura — refresh manual de status
export async function PATCH(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })

  const { data: usuario } = await supabase
    .from('users').select('tenant_id').eq('auth_user_id', user.id).single()
  if (!usuario) return NextResponse.json({ error: 'Não encontrado' }, { status: 404 })

  const { data: signature } = await supabase
    .from('contract_signatures')
    .select('id, d4sign_uuid, status')
    .eq('contrato_id', id)
    .eq('tenant_id', usuario.tenant_id)
    .neq('status', 'cancelled')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (!signature?.d4sign_uuid) {
    return NextResponse.json({ error: 'Nenhuma assinatura ativa' }, { status: 404 })
  }

  try {
    const docStatus = await d4signGetStatus(signature.d4sign_uuid)
    const novoStatus = D4SIGN_STATUS_MAP[docStatus?.statusDoc?.id] ?? signature.status

    if (novoStatus !== signature.status) {
      const update: Record<string, unknown> = { status: novoStatus }
      if (novoStatus === 'completed') update.completed_at = new Date().toISOString()
      await supabase.from('contract_signatures').update(update).eq('id', signature.id)
    }

    // Atualizar status individual dos signatários
    try {
      const { data: listaD4 } = await d4signGetStatus(signature.d4sign_uuid) as unknown as { data: unknown }
      void listaD4 // apenas garante que não há erro silencioso
    } catch { /* silencioso */ }

    return NextResponse.json({ status: novoStatus })
  } catch (err: unknown) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
  }
}

// DELETE /api/contratos/[id]/assinatura — cancelar
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })

  const { data: usuario } = await supabase
    .from('users').select('id, tenant_id, role').eq('auth_user_id', user.id).single()
  if (!usuario) return NextResponse.json({ error: 'Não encontrado' }, { status: 404 })
  if (!['admin', 'advogado'].includes(usuario.role)) {
    return NextResponse.json({ error: 'Sem permissão' }, { status: 403 })
  }

  const body = await req.json().catch(() => ({}))
  const reason: string = body?.reason ?? ''

  const { data: signature } = await supabase
    .from('contract_signatures')
    .select('id, d4sign_uuid, status')
    .eq('contrato_id', id)
    .eq('tenant_id', usuario.tenant_id)
    .neq('status', 'cancelled')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (!signature) return NextResponse.json({ error: 'Nenhuma assinatura ativa' }, { status: 404 })

  if (signature.d4sign_uuid) {
    try { await d4signCancelDocument(signature.d4sign_uuid, reason) } catch { /* silencioso */ }
  }

  await supabase
    .from('contract_signatures')
    .update({ status: 'cancelled', cancelled_at: new Date().toISOString(), cancel_reason: reason || null })
    .eq('id', signature.id)

  return NextResponse.json({ ok: true })
}
