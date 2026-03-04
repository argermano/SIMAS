import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { d4signResendNotification } from '@/lib/d4sign/client'

// POST /api/contratos/[id]/assinatura/reenviar
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })

  const { data: usuario } = await supabase
    .from('users').select('tenant_id').eq('auth_user_id', user.id).single()
  if (!usuario) return NextResponse.json({ error: 'Não encontrado' }, { status: 404 })

  const body = await req.json().catch(() => ({}))
  const signerId: string = body?.signer_id

  if (!signerId) return NextResponse.json({ error: 'signer_id obrigatório' }, { status: 400 })

  // Buscar signatário e assinatura
  const { data: signer } = await supabase
    .from('contract_signature_signers')
    .select('id, d4sign_key, signed, signature_id')
    .eq('id', signerId)
    .single()

  if (!signer) return NextResponse.json({ error: 'Signatário não encontrado' }, { status: 404 })
  if (signer.signed) return NextResponse.json({ error: 'Signatário já assinou' }, { status: 400 })
  if (!signer.d4sign_key) return NextResponse.json({ error: 'Chave do signatário não disponível' }, { status: 400 })

  // Verificar que a assinatura pertence ao tenant
  const { data: signature } = await supabase
    .from('contract_signatures')
    .select('d4sign_uuid')
    .eq('id', signer.signature_id)
    .eq('tenant_id', usuario.tenant_id)
    .single()

  if (!signature?.d4sign_uuid) {
    return NextResponse.json({ error: 'Assinatura não encontrada' }, { status: 404 })
  }

  try {
    await d4signResendNotification(signature.d4sign_uuid, signer.d4sign_key)
    return NextResponse.json({ ok: true })
  } catch (err: unknown) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
  }
}
