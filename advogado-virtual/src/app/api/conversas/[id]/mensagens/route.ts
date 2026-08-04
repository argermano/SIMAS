import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getAuthContext, requireRole } from '@/lib/auth'
import { jsonError, validateBody } from '@/lib/api'
import { relayFetch } from '@/lib/conversas/relay'

const schemaMensagem = z.object({
  content: z.string().min(1),
  private: z.boolean().optional(),
  /**
   * Resposta com CITAÇÃO (padrão WhatsApp): id da mensagem citada no Chatwoot,
   * sempre da MESMA conversa. Vai ao relay como `inReplyTo`, que o repassa em
   * content_attributes.in_reply_to. Inteiro positivo — o id do Chatwoot nunca é
   * fracionário nem negativo, e um valor torto viraria citação silenciosamente
   * perdida lá na ponta. `.safe()` espelha o Number.isSafeInteger do relay: 1e21
   * passa por "inteiro" no zod e chegaria ao Chatwoot como "1e+21".
   */
  emRespostaA: z.number().int().positive().safe().optional(),
})

// GET /api/conversas/[id]/mensagens?before= -> relay GET /conversations/:id/messages
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await getAuthContext()
  if (!auth.ok) return auth.response
  const gate = requireRole(auth.usuario, ['admin', 'advogado', 'colaborador'])
  if (gate) return gate

  const email = auth.user.email
  if (!email) return jsonError('E-mail do usuário ausente na sessão', 400)

  const { id } = await params
  const { searchParams } = new URL(req.url)
  const { status, data } = await relayFetch(`/conversations/${id}/messages`, {
    method: 'GET',
    email,
    query: { before: searchParams.get('before') ?? undefined },
  })

  return NextResponse.json(data, { status })
}

// POST /api/conversas/[id]/mensagens {content, private?, emRespostaA?}
//   -> relay POST /conversations/:id/messages {content, private?, inReplyTo?}
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await getAuthContext()
  if (!auth.ok) return auth.response
  const gate = requireRole(auth.usuario, ['admin', 'advogado', 'colaborador'])
  if (gate) return gate

  const email = auth.user.email
  if (!email) return jsonError('E-mail do usuário ausente na sessão', 400)

  const parsed = await validateBody(req, schemaMensagem)
  if (!parsed.ok) return parsed.response

  const { id } = await params
  // Tradução de nomes na fronteira: a tela fala pt-BR (emRespostaA), o contrato
  // do relay fala inReplyTo. Omitido quando não há citação — assim o relay antigo
  // (sem o campo) continua recebendo exatamente o corpo de antes.
  const { emRespostaA, ...mensagem } = parsed.data
  const { status, data } = await relayFetch(`/conversations/${id}/messages`, {
    method: 'POST',
    email,
    body: emRespostaA === undefined ? mensagem : { ...mensagem, inReplyTo: emRespostaA },
  })

  return NextResponse.json(data, { status })
}
