import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

// GET /api/task-tags
export async function GET() {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })

  const { data: usuario } = await supabase
    .from('users').select('tenant_id').eq('auth_user_id', user.id).single()
  if (!usuario) return NextResponse.json({ error: 'Não encontrado' }, { status: 404 })

  const { data } = await supabase
    .from('task_tags')
    .select('id, name, color')
    .eq('tenant_id', usuario.tenant_id)
    .order('name')

  return NextResponse.json({ tags: data ?? [] })
}
