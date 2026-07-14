import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getAuthContext } from '@/lib/auth'
import { jsonError, validateBody } from '@/lib/api'
import { logAudit } from '@/lib/audit'
import { logger } from '@/lib/logger'
import { enviarEmailMencaoComentario } from '@/lib/email'
import type { createClient } from '@/lib/supabase/server'

type SupabaseServer = Awaited<ReturnType<typeof createClient>>

/**
 * Comentários de uma tarefa (aba "Comentários" do modal de tarefa).
 * Tabela `task_comments` (migração 046: colunas conteudo/autor_id) + menções (@)
 * em `task_comment_mentions` (migração 055). Escopo por tenant + tarefa.
 * Autor sempre = usuário autenticado (nunca vem do corpo).
 *
 * Notificação de menção: e-mail best-effort via Resend (src/lib/email). Se o
 * RESEND_API_KEY estiver ausente, a menção fica só gravada (a UI destaca) —
 * ver decisões no PR. Nunca bloqueia nem derruba a criação do comentário.
 */

const schemaCreate = z
  .object({
    // Aceita `conteudo` (front atual) OU `texto` (contrato). Um dos dois é obrigatório.
    conteudo:    z.string().trim().min(1).max(5000).optional(),
    texto:       z.string().trim().min(1).max(5000).optional(),
    mencionados: z.array(z.string().uuid()).optional(), // ids de colegas do tenant
  })
  .refine((d) => d.conteudo ?? d.texto, { message: 'Comentário vazio', path: ['conteudo'] })

interface PessoaEmbed {
  id: string
  nome: string | null
}

interface MencaoRow {
  user_id: string
  users: PessoaEmbed | PessoaEmbed[] | null
}

interface ComentarioRow {
  id: string
  conteudo: string
  created_at: string
  autor_id: string | null
  users: PessoaEmbed | PessoaEmbed[] | null
  task_comment_mentions: MencaoRow[] | null
}

function um<T>(v: T | T[] | null): T | null {
  return Array.isArray(v) ? (v[0] ?? null) : v
}

function normalizarAutor(row: ComentarioRow): PessoaEmbed | null {
  const u = um(row.users)
  if (u) return { id: u.id, nome: u.nome }
  return row.autor_id ? { id: row.autor_id, nome: null } : null
}

function normalizarMencoes(row: ComentarioRow): PessoaEmbed[] {
  return (row.task_comment_mentions ?? []).map((m) => {
    const u = um(m.users)
    return u ? { id: u.id, nome: u.nome } : { id: m.user_id, nome: null }
  })
}

const SELECT_COMENTARIO =
  'id, conteudo, created_at, autor_id, users(id, nome), task_comment_mentions(user_id, users(id, nome))'

/** Confirma que a tarefa existe e pertence ao tenant; devolve a descrição (p/ e-mail) ou null. */
async function tarefaDoTenant(
  supabase: SupabaseServer,
  taskId: string,
  tenantId: string,
): Promise<{ id: string; description: string } | null> {
  const { data } = await supabase
    .from('tasks')
    .select('id, description')
    .eq('id', taskId)
    .eq('tenant_id', tenantId)
    .maybeSingle()
  return (data as { id: string; description: string } | null) ?? null
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
    .select(SELECT_COMENTARIO)
    .eq('task_id', id)
    .eq('tenant_id', usuario.tenant_id)
    .order('created_at', { ascending: true })

  if (error) return jsonError(error.message, 500)

  const comentarios = ((data ?? []) as ComentarioRow[]).map((row) => ({
    id: row.id,
    conteudo: row.conteudo,
    created_at: row.created_at,
    autor: normalizarAutor(row),
    mencionados: normalizarMencoes(row),
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

  const conteudo = (parsed.data.conteudo ?? parsed.data.texto) as string
  const mencionados = [...new Set(parsed.data.mencionados ?? [])] // dedup

  const tarefa = await tarefaDoTenant(supabase, id, usuario.tenant_id)
  if (!tarefa) return jsonError('Tarefa não encontrada', 404)

  // Cada mencionado precisa ser usuário do tenant (impede sondar IDs / mencionar
  // colega de outro escritório). Já aproveita p/ buscar e-mail e nome da notificação.
  let usuariosMencionados: { id: string; nome: string | null; email: string }[] = []
  if (mencionados.length > 0) {
    const { data: us } = await supabase
      .from('users')
      .select('id, nome, email')
      .eq('tenant_id', usuario.tenant_id)
      .in('id', mencionados)
    usuariosMencionados = (us ?? []) as typeof usuariosMencionados
    if (usuariosMencionados.length !== mencionados.length) {
      return jsonError('Menção inválida (usuário fora do escritório)', 400)
    }
  }

  const { data, error } = await supabase
    .from('task_comments')
    .insert({
      tenant_id: usuario.tenant_id,
      task_id: id,
      autor_id: usuario.id,
      conteudo,
    })
    .select(SELECT_COMENTARIO)
    .single()

  if (error) return jsonError(error.message, 500)
  const row = data as ComentarioRow

  // Grava as menções (RLS: permitido pois o comentário é do tenant). Best-effort,
  // como o e-mail: o comentário JÁ existe; se as menções falharem NÃO devolvemos
  // 500 (evita comentário órfão + reenvio duplicado). Só registra (LGPD: só ids).
  if (mencionados.length > 0) {
    const { error: errMenc } = await supabase
      .from('task_comment_mentions')
      .insert(mencionados.map((uid) => ({ comment_id: row.id, user_id: uid })))
    if (errMenc) logger.error('tarefa.comentario.mencoes_falharam', { comment_id: row.id }, errMenc)
  }

  // Auditoria: só ids (LGPD — nunca o conteúdo do comentário).
  await logAudit({
    tenantId: usuario.tenant_id,
    userId: usuario.id,
    action: 'tarefa.comentario_criado',
    resourceType: 'task',
    resourceId: id,
    metadata: { comment_id: row.id, mencionados },
  })

  // Notifica os mencionados por e-mail (best-effort). Não notifica quem se
  // auto-menciona. enviarEmail nunca lança; allSettled garante a tentativa em
  // ambiente serverless sem derrubar a resposta.
  const aNotificar = usuariosMencionados.filter((u) => u.id !== usuario.id && u.email)
  if (aNotificar.length > 0) {
    await Promise.allSettled(
      aNotificar.map((u) =>
        enviarEmailMencaoComentario({
          para: u.email,
          nomeMencionado: u.nome ?? 'colega',
          nomeAutor: usuario.nome ?? 'Um colega',
          tarefa: tarefa.description,
          conteudo,
        }),
      ),
    )
  }

  return NextResponse.json(
    {
      comentario: {
        id: row.id,
        conteudo: row.conteudo,
        created_at: row.created_at,
        autor: normalizarAutor(row) ?? { id: usuario.id, nome: usuario.nome },
        mencionados: usuariosMencionados.map((u) => ({ id: u.id, nome: u.nome })),
      },
    },
    { status: 201 },
  )
}
