import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getAuthContext, requireRole } from '@/lib/auth'
import { jsonError, validateBody } from '@/lib/api'
import { logAudit } from '@/lib/audit'
import { relayFetchBinario, relaySendAttachment } from '@/lib/conversas/relay'
import { LIMITE_ANEXO_SERVIDOR_BYTES, LIMITE_CAPTION_CHARS } from '@/lib/conversas/anexos'
import { nomeParaEncaminhar, resolverTipoEncaminhado } from '@/lib/conversas/encaminhar'

// maxDuration: encaminhar um VÍDEO de até 40 MB baixa os bytes do relay e os
// repassa ao Chatwoot na MESMA invocação — o default de 10s da Vercel cortava o
// envio no meio. Mesmo teto da rota de anexo do PC.
export const maxDuration = 60

const schema = z.object({
  anexoUrl: z.string().url().max(2000),
  contentType: z.string().max(200).optional(),
  filename: z.string().max(300).optional(),
  caption: z.string().max(LIMITE_CAPTION_CHARS).optional(),
})

// POST /api/conversas/[id]/encaminhar — ENCAMINHA um anexo recebido em outra
// conversa para a conversa DESTINO ([id] da rota). Baixa os bytes server-side pelo
// relay (a proteção SSRF da URL de origem é do relay), revalida o tipo e reenvia.
// Destino SEM conversa (número solto/cliente do cadastro): POST /api/conversas/encaminhar.
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

  const parsed = await validateBody(req, schema)
  if (!parsed.ok) return parsed.response
  const { anexoUrl, contentType: ctHint, filename, caption } = parsed.data

  const { id } = await params
  // Guarda defensiva: id do Chatwoot é numérico (evita path-injection no relay).
  if (!/^\d+$/.test(id)) return jsonError('Conversa inválida', 400)

  // Baixa o anexo de ORIGEM pelo relay (mesmo proxy usado para exibir mídia).
  const origem = await relayFetchBinario('/attachments', {
    method: 'GET',
    email,
    query: { url: anexoUrl },
  })
  if (origem.status !== 200 || !origem.buffer) {
    return jsonError('Não foi possível baixar o anexo de origem', origem.status)
  }
  if (origem.buffer.length > LIMITE_ANEXO_SERVIDOR_BYTES) {
    return jsonError('Anexo excede o limite de 45 MB', 413)
  }

  const nome = nomeParaEncaminhar(filename, anexoUrl)
  const tipo = resolverTipoEncaminhado({ contentTypeRelay: origem.contentType, hint: ctHint, nome })
  if (!tipo.ok) return jsonError(tipo.erro, tipo.status)

  const { status, data } = await relaySendAttachment({
    email,
    conversaId: id,
    bytes: origem.buffer,
    filename: nome,
    contentType: tipo.contentType,
    caption,
  })

  if (status >= 200 && status < 300) {
    await logAudit({
      tenantId: auth.usuario.tenant_id,
      userId: auth.usuario.id,
      action: 'conversas.anexo_encaminhado',
      resourceType: 'conversa',
      resourceId: id,
      metadata: { destino: 'conversa', contentType: tipo.contentType, tamanho: origem.buffer.length },
    })
  }

  return NextResponse.json(data, { status })
}
