import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { taskService } from '@/services/task-service'

// POST /api/pecas/[id]/enviar-revisao — envia peça para fila de revisão e cria tarefa no kanban
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })

  const { data: usuario } = await supabase
    .from('users')
    .select('id, nome, tenant_id')
    .eq('auth_user_id', user.id)
    .single()

  if (!usuario) return NextResponse.json({ error: 'Usuário não encontrado' }, { status: 404 })

  const body = await req.json().catch(() => ({}))
  const prazoRevisao = body.prazo_revisao ?? null

  // Buscar dados da peça com nome do cliente via atendimento
  const { data: peca } = await supabase
    .from('pecas')
    .select('id, tipo, area, status, atendimento_id, atendimentos(clientes(nome))')
    .eq('id', id)
    .eq('tenant_id', usuario.tenant_id)
    .single()

  if (!peca || peca.status !== 'rascunho') {
    return NextResponse.json(
      { error: 'Peça não encontrada ou não está em rascunho' },
      { status: 404 }
    )
  }

  const nomeCliente = (peca.atendimentos as { clientes?: { nome?: string } } | null)
    ?.clientes?.nome ?? 'Cliente'

  // Atualizar status da peça
  const { error: updateError } = await supabase
    .from('pecas')
    .update({
      status: 'aguardando_revisao',
      prazo_revisao: prazoRevisao,
    })
    .eq('id', id)
    .eq('tenant_id', usuario.tenant_id)
    .eq('status', 'rascunho')

  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 500 })
  }

  // Buscar o primeiro advogado/admin do tenant para atribuir a revisão
  const { data: revisores } = await supabase
    .from('users')
    .select('id')
    .eq('tenant_id', usuario.tenant_id)
    .in('role', ['admin', 'advogado'])
    .neq('id', usuario.id)
    .limit(1)

  const revisorId = revisores?.[0]?.id ?? usuario.id

  // Criar tarefa no kanban
  try {
    const tipoFormatado = peca.tipo.replace(/_/g, ' ')
    await taskService.createAutomatic({
      description:     `Revisar peça: ${tipoFormatado} (${peca.area}) — ${nomeCliente}`,
      assigneeId:      revisorId,
      tenantId:        usuario.tenant_id,
      createdBy:       usuario.id,
      priority:        'alta',
      dueDate:         prazoRevisao,
      processId:       peca.atendimento_id ?? undefined,
      originReference: `revisao_peca:${id}`,
      tagNames:        ['REVISÃO'],
    })
  } catch { /* tarefa automática não é crítica */ }

  return NextResponse.json({ ok: true, peca: { id, status: 'aguardando_revisao' } })
}
