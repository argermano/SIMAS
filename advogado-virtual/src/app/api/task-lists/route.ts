import { NextRequest, NextResponse } from 'next/server'
import { getAuthContext } from '@/lib/auth'
import { jsonError } from '@/lib/api'
import { z } from 'zod'

const schema = z.object({ name: z.string().min(1).max(200) })

// GET /api/task-lists
export async function GET() {
  const auth = await getAuthContext()
  if (!auth.ok) return auth.response
  const { supabase, usuario } = auth

  const { data } = await supabase
    .from('task_lists')
    .select('id, name, created_at')
    .eq('tenant_id', usuario.tenant_id)
    .order('created_at')

  return NextResponse.json({ lists: data ?? [] })
}

// POST /api/task-lists
export async function POST(req: NextRequest) {
  const auth = await getAuthContext()
  if (!auth.ok) return auth.response
  const { supabase, usuario } = auth

  const body = await req.json()
  const parsed = schema.safeParse(body)
  if (!parsed.success) return jsonError('Dados inválidos', 400)

  const { data, error } = await supabase
    .from('task_lists')
    .insert({ name: parsed.data.name, tenant_id: usuario.tenant_id, created_by: usuario.id })
    .select()
    .single()

  if (error) return jsonError(error.message, 500)
  return NextResponse.json({ list: data }, { status: 201 })
}
