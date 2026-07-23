import { NextResponse } from 'next/server'
import { getAuthContext } from '@/lib/auth'

/**
 * GET /api/tasks/comentarios-novos → sino de coordenação.
 * Comentários em tarefas onde EU sou responsável (principal) ou envolvido (extra),
 * criados por OUTRO usuário DEPOIS do meu visto_em (ou sem visto), mais recentes
 * primeiro, no máx. 20 → { comentarios: [...], total }.
 *
 * Estratégia (barata e sem `.in()` gigante na URL): monta em memória o conjunto
 * das minhas tarefas (só ids), varre os comentários recentes do tenant feitos por
 * outros e filtra p/ os que caem numa tarefa minha e ainda não vistos.
 */

interface Embed { id?: string | null; nome?: string | null }
interface ComentarioRow {
  id:         string
  task_id:    string
  conteudo:   string | null
  created_at: string
  autor_id:   string | null
  users:      Embed | Embed[] | null
  tasks:      { description?: string | null } | { description?: string | null }[] | null
}

function um<T>(v: T | T[] | null | undefined): T | null {
  return (Array.isArray(v) ? v[0] : v) ?? null
}

// Janela de varredura: os comentários mais recentes do tenant feitos por outros.
// Cobre semanas de coordenação num escritório pequeno; o visto zera os já lidos.
const JANELA = 300

export async function GET() {
  const auth = await getAuthContext()
  if (!auth.ok) return auth.response
  const { supabase, usuario } = auth

  // 1. Minhas tarefas (principal + envolvido) — só ids, em memória.
  const [{ data: principais }, { data: envolvidas }] = await Promise.all([
    supabase.from('tasks').select('id').eq('tenant_id', usuario.tenant_id).eq('assignee_id', usuario.id),
    supabase.from('task_assignees').select('task_id').eq('user_id', usuario.id),
  ])
  const minhas = new Set<string>([
    ...((principais ?? []) as { id: string }[]).map(t => t.id),
    ...((envolvidas ?? []) as { task_id: string }[]).map(a => a.task_id),
  ])
  if (minhas.size === 0) return NextResponse.json({ comentarios: [], total: 0 })

  // 2. Comentários recentes do tenant feitos por OUTROS (mais novos primeiro).
  const { data: coments } = await supabase
    .from('task_comments')
    .select('id, task_id, conteudo, created_at, autor_id, users(id, nome), tasks(description)')
    .eq('tenant_id', usuario.tenant_id)
    .neq('autor_id', usuario.id)
    .order('created_at', { ascending: false })
    .limit(JANELA)

  const candidatos = ((coments ?? []) as ComentarioRow[]).filter(c => minhas.has(c.task_id))
  if (candidatos.length === 0) return NextResponse.json({ comentarios: [], total: 0 })

  // 3. Meu visto por tarefa (só p/ as tarefas que aparecem nos candidatos).
  const taskIds = [...new Set(candidatos.map(c => c.task_id))]
  const { data: vistos } = await supabase
    .from('task_vistos')
    .select('task_id, visto_em')
    .eq('user_id', usuario.id)
    .in('task_id', taskIds)
  const vistoPor = new Map<string, number>(
    ((vistos ?? []) as { task_id: string; visto_em: string }[]).map(v => [v.task_id, new Date(v.visto_em).getTime()]),
  )

  // 4. Novos = criados depois do meu visto (ou sem visto). Máx. 20.
  const comentarios = candidatos
    .filter(c => {
      const visto = vistoPor.get(c.task_id)
      return visto === undefined || new Date(c.created_at).getTime() > visto
    })
    .slice(0, 20)
    .map(c => {
      const autor  = um(c.users)
      const tarefa = um(c.tasks)
      return {
        id:         c.id,
        taskId:     c.task_id,
        taskTitulo: tarefa?.description ?? 'Tarefa',
        autorNome:  autor?.nome ?? 'Colega',
        trecho:     (c.conteudo ?? '').slice(0, 100),
        criadoEm:   c.created_at,
      }
    })

  return NextResponse.json({ comentarios, total: comentarios.length })
}
