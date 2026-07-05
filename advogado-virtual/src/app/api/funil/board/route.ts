import { NextResponse } from 'next/server'
import { getAuthContext } from '@/lib/auth'

export const dynamic = 'force-dynamic'

// GET /api/funil/board — leads atuais do quadro (sessão + RLS). Usado pelo
// polling do kanban para refletir novos cards / movimentações sem recarregar.
export async function GET() {
  const auth = await getAuthContext()
  if (!auth.ok) return auth.response
  const { supabase, usuario } = auth

  const { data: leads } = await supabase
    .from('funil_leads')
    .select(`
      id, nome_informado, telefone, email, area, unidade, origem, etapa, valor_estimado,
      consulta_data, consulta_formato, meet_url, aguardando_confirmacao, sugerir_perda,
      consulta_cancelada, ultima_mensagem, ultima_mensagem_em, ultima_mensagem_autor,
      ultimo_contato_em, chatwoot_conversation_id, created_at, updated_at,
      clientes ( id, nome, status_cadastro )
    `)
    .eq('tenant_id', usuario.tenant_id)
    .order('updated_at', { ascending: false })

  return NextResponse.json({ leads: leads ?? [] })
}
