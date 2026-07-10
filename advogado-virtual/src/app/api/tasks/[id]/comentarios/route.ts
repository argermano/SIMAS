import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getAuthContext } from '@/lib/auth'
import { jsonError, validateBody } from '@/lib/api'
import type { createClient } from '@/lib/supabase/server'

type SupabaseServer = Awaited<ReturnType<typeof createClient>>

/**
 * Comentários de uma tarefa (aba "Comentários" do modal de tarefa).
 * Tabela `task_comments` (migração 046). Escopo por tenant + tarefa.
 * Autor sempre = usuário autenticado (nunca vem do corpo).
 */

const schemaCreate = z.object({
  conteudo: z.string().trim().min(1).max(5000),
})

interface ComentarioRow {
  id: string
  conteudo: string
  created_at: string
  autor_id: string | null
  users: { id: string; nome: string | null } | { id: string; nome: string | null }[] | null
}

function normalizarAutor(row: ComentarioRow): { id: string; nome: string | null } | null {
  const u = Array.isArray(row.users) ? row.users[0] : row.users
  if (u) return { id: u.id, nome: u.nome }
  return row.autor_id ? { id: row.autor_id, nome: null } : null
}

/** Confirma que a tarefa existe e pertence ao tenant do usuário. */
async function tarefaDoTenant(
  supabase: SupabaseServer,
  taskId: string,
  tenantId: string,
): Promise<boolean> {
  const { data } = await supabase
    .from('tasks')
    .select('id')
    .eq('id', taskId)
    .eq('tenant_id', tenantId)
    .maybeSingle()
  return !!data
}

// GET /api/tasks/[id]/comentarios → { comentarios: [...] }
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const auth = await getAuthContext()
  if (!auth.ok) return auth.response
  const { supabase, usuario } = auth

  if (!(await tarefaDoTenant(supabase, id, usuario.tenant_id))) {
    return jsonError('Tarefa não encontrada', 404)
  }

  const { data, error } = await supabase
    .from('task_comments')
    .select('id, conteudo, created_at, autor_id, users(id, nome)')
    .eq('task_id', id)
    .eq('tenant_id', usuario.tenant_id)
    .order('created_at', { ascending: true })

  if (error) return jsonError(error.message, 500)

  const comentarios = ((data ?? []) as ComentarioRow[]).map((row) => ({
    id: row.id,
    conteudo: row.conteudo,
    created_at: row.created_at,
    autor: normalizarAutor(row),
  }))

  return NextResponse.json({ comentarios })
}

// POST /api/tasks/[id]/comentarios → { comentario: {...} }
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const auth = await getAuthContext()
  if (!auth.ok) return auth.response
  const { supabase, usuario } = auth

  const parsed = await validateBody(req, schemaCreate)
  if (!parsed.ok) return parsed.response

  if (!(await tarefaDoTenant(supabase, id, usuario.tenant_id))) {
    return jsonError('Tarefa não encontrada', 404)
  }

  const { data, error } = await supabase
    .from('task_comments')
    .insert({
      tenant_id: usuario.tenant_id,
      task_id: id,
      autor_id: usuario.id,
      conteudo: parsed.data.conteudo,
    })
    .select('id, conteudo, created_at, autor_id, users(id, nome)')
    .single()

  if (error) return jsonError(error.message, 500)

  const row = data as ComentarioRow
  return NextResponse.json(
    {
      comentario: {
        id: row.id,
        conteudo: row.conteudo,
        created_at: row.created_at,
        autor: normalizarAutor(row) ?? { id: usuario.id, nome: usuario.nome },
      },
    },
    { status: 201 },
  )
}
