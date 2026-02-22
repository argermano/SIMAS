import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'

// Rota chamada após o registro: cria tenant + usuário no banco
export async function POST(req: Request) {
  try {
    const { auth_user_id, nome, email, escritorio } = await req.json()

    if (!auth_user_id || !nome || !email) {
      return NextResponse.json({ error: 'Dados inválidos' }, { status: 400 })
    }

    // Usa service role key para bypass do RLS (necessário para criar tenant)
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    )

    // Verifica se usuário já existe (idempotente)
    const { data: usuarioExistente } = await supabase
      .from('users')
      .select('id')
      .eq('auth_user_id', auth_user_id)
      .single()

    if (usuarioExistente) {
      return NextResponse.json({ ok: true, already_exists: true })
    }

    // 1. Cria o tenant (escritório)
    const { data: tenant, error: tenantError } = await supabase
      .from('tenants')
      .insert({
        nome:   escritorio || `Escritório de ${nome}`,
        plano:  'trial',
        status: 'ativo',
      })
      .select('id')
      .single()

    if (tenantError) throw tenantError

    // 2. Cria o usuário vinculado ao tenant (como admin)
    const { error: userError } = await supabase
      .from('users')
      .insert({
        tenant_id:    tenant.id,
        auth_user_id: auth_user_id,
        nome:         nome,
        email:        email,
        role:         'admin',
        status:       'ativo',
      })

    if (userError) throw userError

    return NextResponse.json({ ok: true, tenant_id: tenant.id })
  } catch (err) {
    console.error('Erro em /api/auth/setup-user:', err)
    return NextResponse.json(
      { error: 'Erro interno ao configurar usuário' },
      { status: 500 }
    )
  }
}
