import { NextResponse } from 'next/server'
import { getAuthContext, requireRole } from '@/lib/auth'
import { jsonError } from '@/lib/api'

// GET /api/processos/notificacoes — fila de avisos aguardando aprovação (pendente)
// e os que falharam no envio automático (erro, para reenvio manual). admin/advogado.
export async function GET() {
  const auth = await getAuthContext()
  if (!auth.ok) return auth.response
  const { supabase, usuario } = auth
  const gate = requireRole(usuario, ['admin', 'advogado'])
  if (gate) return gate

  const { data, error } = await supabase
    .from('processo_movimentos')
    .select(
      'id, nome, resumo_ia, categoria, data_hora, notif_status, notif_texto, created_at, ' +
      'processo:processos!inner(id, numero_cnj, apelido, cliente:clientes(id, nome, telefone))',
    )
    .in('notif_status', ['pendente', 'erro'])
    .order('created_at', { ascending: false })
    .limit(200)

  if (error) return jsonError(error.message, 500)
  return NextResponse.json({ notificacoes: data ?? [] })
}
