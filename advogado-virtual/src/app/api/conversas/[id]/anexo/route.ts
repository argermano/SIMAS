import { NextRequest, NextResponse } from 'next/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { z } from 'zod'
import { getAuthContext, requireRole } from '@/lib/auth'
import { jsonError, validateBody } from '@/lib/api'
import { logAudit } from '@/lib/audit'
import { logger } from '@/lib/logger'
import { relaySendAttachment } from '@/lib/conversas/relay'
import {
  tipoAnexoPermitido,
  tipoBase,
  mimePorNomeArquivo,
  pathAnexoEnvioValido,
  LIMITE_ANEXO_SERVIDOR_BYTES,
  LIMITE_CAPTION_CHARS,
} from '@/lib/conversas/anexos'

const schema = z.object({
  // Path do objeto temporário subido pelo browser via .../anexo/preparar.
  storagePath: z.string().min(1).max(500),
  filename: z.string().min(1).max(300),
  mimetype: z.string().max(200),
  caption: z.string().max(LIMITE_CAPTION_CHARS).optional(),
})

// POST /api/conversas/[id]/anexo — envia ao cliente um ARQUIVO DO PC que o browser
// já subiu DIRETO ao Storage (via .../anexo/preparar). Recebe JSON com o
// storagePath, baixa os bytes com o admin client, repassa ao relay (que resolve o
// token pessoal do agente e posta no Chatwoot) e apaga o objeto temporário.
// LGPD: audita só ids/tipo/tamanho — nunca o nome do arquivo nem conteúdo.
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await getAuthContext()
  if (!auth.ok) return auth.response
  const gate = requireRole(auth.usuario, ['admin', 'advogado', 'colaborador'])
  if (gate) return gate
  const { usuario } = auth

  const email = auth.user.email
  if (!email) return jsonError('E-mail do usuário ausente na sessão', 400)

  const { id } = await params
  // Ids do Chatwoot são numéricos; guarda defensiva antes de interpolar no path
  // do relay (que carrega o Bearer de serviço) — bloqueia '..'/'%2F' decodificados.
  if (!/^\d+$/.test(id)) return jsonError('Conversa inválida', 400)

  const parsed = await validateBody(req, schema)
  if (!parsed.ok) return parsed.response
  const { storagePath, filename, mimetype, caption: captionRaw } = parsed.data

  // LIÇÃO DA AUDITORIA: o storagePath vem do cliente e o admin client abaixo ignora
  // a RLS — SÓ pode baixar/apagar objeto no prefixo de envio DESTE tenant.
  if (!pathAnexoEnvioValido(storagePath, usuario.tenant_id)) {
    return jsonError('Caminho de anexo inválido', 400)
  }

  // Alguns SOs/navegadores dão File.type '' para .doc/.docx: cai na extensão.
  const contentType = tipoBase(mimetype) || mimePorNomeArquivo(filename)
  if (!tipoAnexoPermitido(contentType)) {
    return jsonError('Tipo de arquivo não permitido', 400)
  }

  const caption = captionRaw?.trim() ? captionRaw.trim() : undefined

  const admin = createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )

  // O Storage de envio não é lixeira: o objeto temporário é apagado em qualquer
  // desfecho. Best-effort — a falha só loga (id da conversa, sem path/nome).
  const apagarTemporario = async () => {
    const { error } = await admin.storage.from('documentos').remove([storagePath])
    if (error) logger.error('conversas.anexo.remover_temp', { conversaId: id }, error)
  }

  const { data: blob, error: dlErr } = await admin.storage
    .from('documentos')
    .download(storagePath)
  if (dlErr || !blob) {
    await apagarTemporario()
    return jsonError('Falha ao baixar o anexo', 502)
  }

  const bytes = Buffer.from(await blob.arrayBuffer())
  if (bytes.length > LIMITE_ANEXO_SERVIDOR_BYTES) {
    await apagarTemporario()
    return jsonError(
      `Arquivo excede o limite de ${Math.round(LIMITE_ANEXO_SERVIDOR_BYTES / (1024 * 1024))} MB`,
      413,
    )
  }

  const { status, data } = await relaySendAttachment({
    email,
    conversaId: id,
    bytes,
    filename,
    contentType,
    caption,
  })

  // Sucesso OU falha de envio: o objeto temporário sai do bucket.
  await apagarTemporario()

  if (status >= 200 && status < 300) {
    await logAudit({
      tenantId: usuario.tenant_id,
      userId: usuario.id,
      action: 'conversas.anexo_enviado',
      resourceType: 'conversa',
      resourceId: id,
      metadata: { contentType, tamanho: bytes.length },
    })
  }

  return NextResponse.json(data, { status })
}
