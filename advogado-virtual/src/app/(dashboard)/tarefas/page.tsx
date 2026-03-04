import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { KanbanPageClient } from './KanbanPageClient'

export const metadata = { title: 'Tarefas — Kanban' }
export const dynamic  = 'force-dynamic'

export default async function TarefasPage() {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: usuario } = await supabase
    .from('users')
    .select('id, nome, tenant_id')
    .eq('auth_user_id', user.id)
    .single()
  if (!usuario) redirect('/login')

  // Busca boards (também faz seed automático se necessário — via GET /api/kanban-boards)
  // No server component fazemos direto no Supabase
  const { data: boards } = await supabase
    .from('kanban_boards')
    .select('id, name, kanban_columns(id, name, position, color)')
    .eq('tenant_id', usuario.tenant_id)
    .order('created_at')

  const { data: tags } = await supabase
    .from('task_tags')
    .select('id, name, color')
    .eq('tenant_id', usuario.tenant_id)
    .order('name')

  // Se não existem boards ainda, faz seed via API
  const boardList = boards ?? []
  let tagList = tags ?? []

  if (boardList.length === 0) {
    // Trigger seed via API route (que cria board + list + tags padrão)
    try {
      await fetch(`${process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000'}/api/kanban-boards`, {
        headers: { Cookie: '' }, // seed será feito na primeira visita client-side
      })
    } catch { /* ignora */ }
  }

  const sortedBoards = boardList.map(b => ({
    ...b,
    kanban_columns: [...(b.kanban_columns ?? [])].sort(
      (a: { position: number }, b: { position: number }) => a.position - b.position
    ),
  }))

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <KanbanPageClient
        boards={sortedBoards}
        tags={tagList}
        currentUserId={usuario.id}
        currentUserName={usuario.nome ?? user.email ?? 'Você'}
      />
    </div>
  )
}
