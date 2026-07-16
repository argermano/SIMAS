import { NextRequest, NextResponse } from 'next/server'
import { getAuthContext, requireRole } from '@/lib/auth'
import { jsonError } from '@/lib/api'
import { apenasDigitos, mesmoTelefone } from '@/lib/conversas/telefone'
import { relayFetch } from '@/lib/conversas/relay'
import { TAMANHO_PAGINA_CONVERSAS } from '@/lib/conversas/lista-infinita'
import type { Conversa, RespostaLista } from '@/lib/conversas/tipos'

// GET /api/clientes/[id]/conversas — conversas de WhatsApp (relay Chatwoot) que
// casam com o telefone do cliente, para o card "Conversas no WhatsApp" do dossiê.
// Chamada SOB DEMANDA (lazy) pela UI: o relay não tem busca por telefone, então
// varremos as conversas mais ativas (open + resolved) com TETO de páginas e
// filtramos por mesmoTelefone (tolerante a máscara/DDI/9º dígito). O teto limita
// o custo do relay. Sem telefone no cadastro => { semTelefone: true, conversas: [] }.
// LGPD: nada de conteúdo de mensagem em log (esta rota não loga).

// Teto de varredura por status: 4 páginas × 25 = 100 conversas mais ativas/status.
const MAX_PAGINAS = 4

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await getAuthContext()
  if (!auth.ok) return auth.response
  const gate = requireRole(auth.usuario, ['admin', 'advogado', 'colaborador'])
  if (gate) return gate
  const { supabase, usuario } = auth

  const email = auth.user.email
  if (!email) return jsonError('E-mail do usuário ausente na sessão', 400)

  const { id } = await params

  // Cliente do tenant (defesa em profundidade além do RLS). O telefone fica em
  // texto-plano — só cpf/rg são cifrados em repouso (decryptClienteFields).
  const { data: cliente } = await supabase
    .from('clientes')
    .select('id, telefone')
    .eq('id', id)
    .eq('tenant_id', usuario.tenant_id)
    .is('deleted_at', null)
    .single()
  if (!cliente) return jsonError('Cliente não encontrado', 404)

  const telefone = cliente.telefone
  if (!telefone || apenasDigitos(telefone).length < 10) {
    return NextResponse.json({ semTelefone: true, conversas: [] })
  }

  // Varre open + resolved até o teto de páginas; para cedo quando a página vem
  // incompleta (fim da lista). Filtra por telefone e deduplica por id.
  const encontradas = new Map<number, Conversa>()
  let algumSucesso = false
  let ultimoErro: { status: number; data: unknown } | null = null

  for (const status of ['open', 'resolved'] as const) {
    for (let page = 1; page <= MAX_PAGINAS; page++) {
      const { status: st, data } = await relayFetch('/conversations', {
        method: 'GET',
        email,
        query: { status, page: String(page) },
      })
      if (st >= 400) {
        ultimoErro = { status: st, data }
        break
      }
      algumSucesso = true
      const lista = (data as RespostaLista).conversas ?? []
      for (const c of lista) {
        if (mesmoTelefone(c.contato?.telefone, telefone)) encontradas.set(c.id, c)
      }
      if (lista.length < TAMANHO_PAGINA_CONVERSAS) break // fim da paginação deste status
    }
  }

  // Só surface erro se o relay falhou por completo; qualquer página que respondeu
  // já é a verdade (lista possivelmente vazia = cliente sem conversa aberta).
  if (!algumSucesso) {
    return NextResponse.json(
      ultimoErro?.data ?? { code: 'RELAY_INDISPONIVEL' },
      { status: ultimoErro?.status ?? 502 },
    )
  }

  // Mais recente primeiro (pela última mensagem; desempate por id).
  const conversas = [...encontradas.values()].sort((a, b) => {
    const ta = a.ultimaMensagem?.timestamp ?? 0
    const tb = b.ultimaMensagem?.timestamp ?? 0
    return tb - ta || b.id - a.id
  })

  return NextResponse.json({ semTelefone: false, conversas })
}
