import { NextRequest, NextResponse } from 'next/server'
import { getAuthContext, requireRole } from '@/lib/auth'
import { jsonError } from '@/lib/api'
import { logAudit } from '@/lib/audit'
import { relaySendAttachment } from '@/lib/conversas/relay'
import {
  tipoAnexoPermitido,
  tipoBase,
  mimePorNomeArquivo,
  LIMITE_UPLOAD_BYTES,
  LIMITE_CAPTION_CHARS,
} from '@/lib/conversas/anexos'

// POST /api/conversas/[id]/anexo — envia um ARQUIVO DO COMPUTADOR ao cliente.
// Recebe multipart/form-data (campo "file" + "caption"?), valida tipo/tamanho e
// repassa os bytes ao relay, que resolve o token pessoal do agente e posta no
// Chatwoot. LGPD: audita só ids/tipo/tamanho — nunca o nome do arquivo nem conteúdo.
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

  const { id } = await params
  // Ids do Chatwoot são numéricos; guarda defensiva antes de interpolar no path
  // do relay (que carrega o Bearer de serviço) — bloqueia '..'/'%2F' decodificados.
  if (!/^\d+$/.test(id)) return jsonError('Conversa inválida', 400)

  let form: FormData
  try {
    form = await req.formData()
  } catch {
    return jsonError('Corpo inválido (esperado multipart/form-data)', 400)
  }

  const file = form.get('file')
  if (!(file instanceof File) || file.size === 0) {
    return jsonError('Campo "file" é obrigatório', 400)
  }

  // Alguns SOs/navegadores dão File.type '' para .doc/.docx: cai na extensão.
  const contentType = tipoBase(file.type) || mimePorNomeArquivo(file.name)
  if (!tipoAnexoPermitido(contentType)) {
    return jsonError('Tipo de arquivo não permitido', 400)
  }
  if (file.size > LIMITE_UPLOAD_BYTES) {
    return jsonError('Arquivo excede o limite de 4 MB', 413)
  }

  const captionRaw = form.get('caption')
  const caption = typeof captionRaw === 'string' && captionRaw.trim() ? captionRaw.trim() : undefined
  if (caption && caption.length > LIMITE_CAPTION_CHARS) {
    return jsonError('Legenda excede 1024 caracteres', 400)
  }

  const bytes = Buffer.from(await file.arrayBuffer())

  const { status, data } = await relaySendAttachment({
    email,
    conversaId: id,
    bytes,
    filename: file.name,
    contentType,
    caption,
  })

  if (status >= 200 && status < 300) {
    await logAudit({
      tenantId: auth.usuario.tenant_id,
      userId: auth.usuario.id,
      action: 'conversas.anexo_enviado',
      resourceType: 'conversa',
      resourceId: id,
      metadata: { contentType, tamanho: file.size },
    })
  }

  return NextResponse.json(data, { status })
}
