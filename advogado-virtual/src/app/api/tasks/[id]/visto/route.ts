import { NextResponse } from 'next/server'
import { getAuthContext } from '@/lib/auth'
import { jsonError } from '@/lib/api'

// POST /api/tasks/[id]/visto → marca (upsert) que EU abri o detalhe desta tarefa
// agora. Alimenta o sino: comentários criados por outros ANTES deste instante
// deixam de contar como "novos" p/ mim. Idempotente (PK task_id+user_id).
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const auth = await getAuthContext()
  if (!auth.ok) return auth.response
  const { supabase, usuario } = auth

  // Confirma que a tarefa é do tenant (evita gravar visto de tarefa alheia / sondar ids).
  const { data: tarefa } = await supabase
    .from('tasks')
    .select('id')
    .eq('id', id)
    .eq('tenant_id', usuario.tenant_id)
    .maybeSingle()
  if (!tarefa) return jsonError('Tarefa não encontrada', 404)

  const { error } = await supabase
    .from('task_vistos')
    .upsert(
      {
        tenant_id: usuario.tenant_id,
        task_id:   id,
        user_id:   usuario.id,
        visto_em:  new Date().toISOString(),
      },
      { onConflict: 'task_id,user_id' },
    )

  if (error) return jsonError(error.message, 500)
  return NextResponse.json({ ok: true })
}
