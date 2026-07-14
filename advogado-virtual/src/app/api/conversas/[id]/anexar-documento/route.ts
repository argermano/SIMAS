import { NextRequest, NextResponse } from 'next/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { z } from 'zod'
import { getAuthContext, requireRole } from '@/lib/auth'
import { jsonError, validateBody } from '@/lib/api'
import { logAudit } from '@/lib/audit'
import { relaySendAttachment } from '@/lib/conversas/relay'
import {
  tipoAnexoPermitido,
  tipoBase,
  extensaoPorMime,
  LIMITE_ANEXO_SERVIDOR_BYTES,
} from '@/lib/conversas/anexos'
import { markdownToDocx } from '@/lib/export/docx-generator'
import { aplicarTimbrado } from '@/lib/export/aplicar-timbrado'
import { resolverEstiloEfetivo } from '@/lib/format/estilo-documento'
import { TIPOS_PECA } from '@/lib/constants/tipos-peca'

const MIME_DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'

// Aceita um documento armazenado (arquivo real no bucket) OU uma peça (exportada
// para .docx aqui, reusando a mesma cadeia do /api/exportar — sem inventar export).
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

  let bytes: Buffer
  let contentType: string
  let filename: string
  let origem: 'documento' | 'peca'
  let refId: string

  if (documentoId) {
    origem = 'documento'
    refId = documentoId
    // RLS garante o tenant; ainda assim filtramos explicitamente.
    const { data: doc } = await supabase
      .from('documentos')
      .select('id, file_url, file_name, mime_type, tipo')
      .eq('id', documentoId)
      .eq('tenant_id', usuario.tenant_id)
      .single()
    if (!doc || !doc.file_url) return jsonError('Documento não encontrado', 404)

    contentType = tipoBase(doc.mime_type)
    if (!tipoAnexoPermitido(contentType)) {
      return jsonError('Tipo de documento não permitido para envio', 400)
    }
    // Defesa em profundidade: o path do storage começa com o tenant do usuário.
    if (!String(doc.file_url).startsWith(`${usuario.tenant_id}/`)) {
      return jsonError('Documento fora do tenant', 403)
    }

    const admin = createAdminClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    )
    const { data: blob, error } = await admin.storage.from('documentos').download(doc.file_url)
    if (error || !blob) return jsonError('Falha ao baixar o documento', 502)

    bytes = Buffer.from(await blob.arrayBuffer())
    // Sem file_name, o nome ficaria sem extensão e o WhatsApp não associaria a
    // um app: acrescenta a extensão canônica do MIME (ex.: contrato -> contrato.pdf).
    filename = doc.file_name ?? `${doc.tipo ?? 'documento'}${extensaoPorMime(contentType)}`
  } else {
    origem = 'peca'
    refId = pecaId!
    const { data: peca } = await supabase
      .from('pecas')
      .select('id, tipo, area, versao, conteudo_markdown')
      .eq('id', pecaId!)
      .eq('tenant_id', usuario.tenant_id)
      .single()
    if (!peca) return jsonError('Peça não encontrada', 404)
    if (!peca.conteudo_markdown) return jsonError('Peça sem conteúdo', 400)

    const titulo = TIPOS_PECA[peca.tipo]?.nome ?? peca.tipo
    const estilo = await resolverEstiloEfetivo(supabase, usuario.tenant_id, {
      tipo: 'peca',
      subtipo: peca.tipo,
    })
    let buffer = await markdownToDocx(peca.conteudo_markdown, { titulo, area: peca.area, estilo })

    // Aplica o papel timbrado do escritório, se houver (best-effort — igual ao export).
    const { data: timbrado } = await supabase.storage
      .from('documentos')
      .download(`${usuario.tenant_id}/timbrado/timbrado.docx`)
    if (timbrado) {
      try {
        buffer = aplicarTimbrado(Buffer.from(await timbrado.arrayBuffer()), buffer)
      } catch {
        /* timbrado inválido não bloqueia o envio */
      }
    }

    bytes = buffer
    contentType = MIME_DOCX
    filename = `${String(titulo).replace(/\s+/g, '_')}_v${peca.versao}.docx`
  }

  // Teto de tamanho (docs do bucket podem ser grandes) para não estourar a função.
  if (bytes.length > LIMITE_ANEXO_SERVIDOR_BYTES) {
    return jsonError('Documento excede o limite de 25 MB', 413)
  }

  const { status, data } = await relaySendAttachment({
    email,
    conversaId: id,
    bytes,
    filename,
    contentType,
    caption,
  })

  if (status >= 200 && status < 300) {
    await logAudit({
      tenantId: usuario.tenant_id,
      userId: usuario.id,
      action: 'conversas.anexo_documento',
      resourceType: 'conversa',
      resourceId: id,
      metadata: { origem, refId, contentType, tamanho: bytes.length },
    })
  }

  return NextResponse.json(data, { status })
}
