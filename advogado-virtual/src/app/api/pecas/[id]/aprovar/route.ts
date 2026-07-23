import { NextRequest, NextResponse } from 'next/server'
import { getAuthContext } from '@/lib/auth'
import { jsonError } from '@/lib/api'
import { enviarEmailPecaAprovada, urlBaseApp } from '@/lib/email'
import { TIPOS_PECA } from '@/lib/constants/tipos-peca'
import { LABELS_AREA } from '@/types'
import { materializarPecaNoDossie } from '@/lib/pecas/materializar'

const ROLES_REVISORES = ['admin', 'advogado']

/** Monta uma descrição legível da peça para a notificação (ex.: "Réplica (Cível)"). */
function descreverPeca(tipo: string, area: string): string {
  const nomeTipo = TIPOS_PECA[tipo]?.nome ?? tipo
  const nomeArea = LABELS_AREA[area as keyof typeof LABELS_AREA] ?? area
  return `${nomeTipo} (${nomeArea})`
}

// POST /api/pecas/[id]/aprovar — aprova peça em fila de revisão
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const auth = await getAuthContext()
  if (!auth.ok) return auth.response
  const { supabase, usuario } = auth

  if (!ROLES_REVISORES.includes(usuario.role)) {
    return jsonError('Sem permissão para aprovar peças', 403)
  }

  const { data: peca, error } = await supabase
    .from('pecas')
    .update({
      status:       'rascunho',
      revisado_por: usuario.id,
      revisado_at:  new Date().toISOString(),
    })
    .eq('id', id)
    .eq('tenant_id', usuario.tenant_id)
    .eq('status', 'aguardando_revisao')
    .select('id, status, area, tipo, conteudo_markdown, atendimento_id, autor:users!pecas_created_by_fkey(nome, email), atendimentos(clientes(nome))')
    .single()

  if (error || !peca) {
    return jsonError('Peça não encontrada ou não está aguardando revisão', 404)
  }

  // Estado final (revisão aprovada) → materializa o .docx no dossiê do caso.
  // Best-effort: nunca bloqueia a aprovação (o humano decide o conteúdo/estado).
  await materializarPecaNoDossie(supabase, {
    id: peca.id,
    tipo: peca.tipo,
    area: peca.area,
    conteudo_markdown: peca.conteudo_markdown ?? null,
    atendimento_id: peca.atendimento_id ?? null,
    tenant_id: usuario.tenant_id,
  })

  // Auto-concluir tarefa de revisão associada no kanban
  const { data: taskRevisao } = await supabase
    .from('tasks')
    .select('id, kanban_board_id')
    .eq('tenant_id', usuario.tenant_id)
    .eq('origin_reference', `revisao_peca:${id}`)
    .is('completed_at', null)
    .single()

  if (taskRevisao) {
    // Buscar última coluna (Concluída) do board
    let concluídaColumnId: string | null = null
    if (taskRevisao.kanban_board_id) {
      const { data: cols } = await supabase
        .from('kanban_columns')
        .select('id, position')
        .eq('board_id', taskRevisao.kanban_board_id)
        .order('position', { ascending: false })
        .limit(1)

      concluídaColumnId = cols?.[0]?.id ?? null
    }

    await supabase
      .from('tasks')
      .update({
        completed_at: new Date().toISOString(),
        ...(concluídaColumnId ? { kanban_column_id: concluídaColumnId } : {}),
      })
      .eq('id', taskRevisao.id)
  }

  // Notifica o autor (o colaborador perde a peça de vista ao enviar; o e-mail
  // fecha o ciclo). Efeito colateral best-effort — não bloqueia o resultado.
  const autor = peca.autor as unknown as { nome?: string; email?: string } | null
  const cliente = (peca.atendimentos as unknown as { clientes?: { nome?: string } | null } | null)?.clientes?.nome ?? null
  let emailNotificado = false
  if (autor?.email) {
    emailNotificado = await enviarEmailPecaAprovada({
      para: autor.email,
      nomeAutor: autor.nome ?? 'colega',
      descricaoPeca: descreverPeca(peca.tipo, peca.area),
      cliente,
      pecaUrl: `${urlBaseApp()}/${peca.area}/editor/${id}`,
    })
  }

  return NextResponse.json({ ok: true, peca: { id: peca.id, status: peca.status }, emailNotificado })
}
