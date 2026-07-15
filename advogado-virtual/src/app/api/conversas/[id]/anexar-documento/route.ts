import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getAuthContext, requireRole } from '@/lib/auth'
import { jsonError, validateBody } from '@/lib/api'
import { logAudit } from '@/lib/audit'
import { relaySendAttachment } from '@/lib/conversas/relay'
import { carregarBytesAnexo } from '@/lib/conversas/anexo-documento'

// Aceita um documento armazenado (arquivo real no bucket) OU uma peça (exportada
// para .docx, reusando a mesma cadeia do /api/exportar — sem inventar export).
const schema = z
  .object({
    documentoId: z.string().uuid().optional(),
    pecaId: z.string().uuid().optional(),
    caption: z.string().max(1024).optional(),
  })
  .refine((d) => !!d.documentoId !== !!d.pecaId, {
    message: 'Informe exatamente um: documentoId OU pecaId',
  })

// POST /api/conversas/[id]/anexar-documento — anexa um documento JÁ no SIMAS
// (do caso) e o envia ao cliente na conversa [id]. Tenant sempre validado.
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
  const { documentoId, pecaId, caption } = parsed.data

  const { id } = await params
  // Guarda defensiva: id do Chatwoot é numérico (evita path-injection no relay).
  if (!/^\d+$/.test(id)) return jsonError('Conversa inválida', 400)
  const { supabase, usuario } = auth

  // Toda a carga de bytes (validação de tenant/tipo/prefixo, download e export de
  // peça, teto de 25 MB) vive no helper — compartilhado com o envio no atendimento.
  const anexo = await carregarBytesAnexo({
    supabase,
    tenantId: usuario.tenant_id,
    documentoId,
    pecaId,
  })
  if (!anexo.ok) return jsonError(anexo.erro, anexo.status)

  const { status, data } = await relaySendAttachment({
    email,
    conversaId: id,
    bytes: anexo.bytes,
    filename: anexo.filename,
    contentType: anexo.contentType,
    caption,
  })

  if (status >= 200 && status < 300) {
    await logAudit({
      tenantId: usuario.tenant_id,
      userId: usuario.id,
      action: 'conversas.anexo_documento',
      resourceType: 'conversa',
      resourceId: id,
      metadata: {
        origem: documentoId ? 'documento' : 'peca',
        refId: documentoId ?? pecaId,
        contentType: anexo.contentType,
        tamanho: anexo.bytes.length,
      },
    })
  }

  return NextResponse.json(data, { status })
}
