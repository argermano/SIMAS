import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

const DEFAULT_BOARD_NAME   = 'QUADRO KANBAN PADRÃO'
const DEFAULT_COLUMNS      = [
  { name: 'A Fazer',   position: 0, color: '#3b82f6' },
  { name: 'Fazendo',   position: 1, color: '#f59e0b' },
  { name: 'Concluída', position: 2, color: '#10b981' },
]
const DEFAULT_LIST_NAME    = 'Tarefas Gerais'
const DEFAULT_TAGS = [
  { name: 'URGENTE',  color: '#f97316' },
  { name: 'REVISÃO',  color: '#3b82f6' },
]

// GET /api/kanban-boards — retorna boards com colunas; cria board padrão se não existir
export async function GET() {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })

  const { data: usuario } = await supabase
    .from('users')
    .select('id, tenant_id')
    .eq('auth_user_id', user.id)
    .single()
  if (!usuario) return NextResponse.json({ error: 'Usuário não encontrado' }, { status: 404 })

  let { data: boards } = await supabase
    .from('kanban_boards')
    .select('*, kanban_columns(*)')
    .eq('tenant_id', usuario.tenant_id)
    .order('created_at')

  // Seed automático: cria board/list/tags padrão se o tenant ainda não tiver nenhum
  if (!boards || boards.length === 0) {
    const { data: newBoard, error: boardErr } = await supabase
      .from('kanban_boards')
      .insert({ name: DEFAULT_BOARD_NAME, tenant_id: usuario.tenant_id, created_by: usuario.id })
      .select()
      .single()

    if (boardErr || !newBoard) return NextResponse.json({ error: 'Erro ao criar board padrão' }, { status: 500 })

    const colsToInsert = DEFAULT_COLUMNS.map(c => ({ ...c, board_id: newBoard.id }))
    await supabase.from('kanban_columns').insert(colsToInsert)

    // Lista padrão
    await supabase.from('task_lists').insert({
      name: DEFAULT_LIST_NAME, tenant_id: usuario.tenant_id, created_by: usuario.id,
    })

    // Tags padrão
    await supabase.from('task_tags').insert(
      DEFAULT_TAGS.map(t => ({ ...t, tenant_id: usuario.tenant_id }))
    )

    // Rebuscar com colunas
    const { data: refreshed } = await supabase
      .from('kanban_boards')
      .select('*, kanban_columns(*)')
      .eq('tenant_id', usuario.tenant_id)
      .order('created_at')

    boards = refreshed
  }

  // Ordenar colunas por position
  const resultado = (boards ?? []).map(b => ({
    ...b,
    kanban_columns: [...(b.kanban_columns ?? [])].sort(
      (a: { position: number }, b: { position: number }) => a.position - b.position
    ),
  }))

  return NextResponse.json({ boards: resultado })
}
