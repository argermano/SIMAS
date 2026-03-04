import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { z } from 'zod'

const schema = z.object({ name: z.string().min(1).max(200) })

// GET /api/task-lists
export async function GET() {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })

  const { data: usuario } = await supabase
    .from('users').select('tenant_id').eq('auth_user_id', user.id).single()
  if (!usuario) return NextResponse.json({ error: 'Não encontrado' }, { status: 404 })

  const { data } = await supabase
    .from('task_lists')
    .select('id, name, created_at')
    .eq('tenant_id', usuario.tenant_id)
    .order('created_at')

  return NextResponse.json({ lists: data ?? [] })
}

// POST /api/task-lists
export async function POST(req: NextRequest) {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })

  const { data: usuario } = await supabase
    .from('users').select('id, tenant_id').eq('auth_user_id', user.id).single()
  if (!usuario) return NextResponse.json({ error: 'Não encontrado' }, { status: 404 })

  const body = await req.json()
  const parsed = schema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: 'Dados inválidos' }, { status: 400 })

  const { data, error } = await supabase
    .from('task_lists')
    .insert({ name: parsed.data.name, tenant_id: usuario.tenant_id, created_by: usuario.id })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ list: data }, { status: 201 })
}
