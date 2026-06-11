import { NextResponse } from 'next/server'
import { getAuthContext } from '@/lib/auth'

// GET /api/task-tags
export async function GET() {
  const auth = await getAuthContext()
  if (!auth.ok) return auth.response
  const { supabase, usuario } = auth

  const { data } = await supabase
    .from('task_tags')
    .select('id, name, color')
    .eq('tenant_id', usuario.tenant_id)
    .order('name')

  return NextResponse.json({ tags: data ?? [] })
}
