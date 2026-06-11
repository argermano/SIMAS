import { NextRequest, NextResponse } from 'next/server'
import { d4signResendNotification } from '@/lib/d4sign/client'
import { getAuthContext } from '@/lib/auth'
import { jsonError } from '@/lib/api'

// POST /api/contratos/[id]/assinatura/reenviar
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params

  const auth = await getAuthContext()
  if (!auth.ok) return auth.response
  const { supabase, usuario } = auth

  const body = await req.json().catch(() => ({}))
  const signerId: string = body?.signer_id

  if (!signerId) return jsonError('signer_id obrigatório', 400)

  // Buscar signatário e assinatura
  const { data: signer } = await supabase
    .from('contract_signature_signers')
    .select('id, d4sign_key, signed, signature_id')
    .eq('id', signerId)
    .single()

  if (!signer) return jsonError('Signatário não encontrado', 404)
  if (signer.signed) return jsonError('Signatário já assinou', 400)
  if (!signer.d4sign_key) return jsonError('Chave do signatário não disponível', 400)

  // Verificar que a assinatura pertence ao tenant
  const { data: signature } = await supabase
    .from('contract_signatures')
    .select('d4sign_uuid')
    .eq('id', signer.signature_id)
    .eq('tenant_id', usuario.tenant_id)
    .single()

  if (!signature?.d4sign_uuid) {
    return jsonError('Assinatura não encontrada', 404)
  }

  try {
    await d4signResendNotification(signature.d4sign_uuid, signer.d4sign_key)
    return NextResponse.json({ ok: true })
  } catch (err: unknown) {
    return jsonError(err instanceof Error ? err.message : String(err), 500)
  }
}
