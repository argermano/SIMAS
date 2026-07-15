// server-only: carrega os BYTES de um anexo a partir do que JÁ existe no SIMAS —
// um documento do bucket (arquivo real) OU uma peça (exportada para .docx aqui,
// reusando a mesma cadeia do /api/exportar). Tenant sempre validado. Extraído da
// rota /api/conversas/[id]/anexar-documento para ser reusado pelo envio de anexos
// no WhatsApp do atendimento (mesmo comportamento, um único ponto de verdade).
// SERVER-ONLY: usa SERVICE_ROLE_KEY; nunca importar do bundle do cliente.

import { createClient as createAdminClient } from '@supabase/supabase-js'
import type { createClient } from '@/lib/supabase/server'
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

type SupabaseServer = Awaited<ReturnType<typeof createClient>>

const MIME_DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'

export type CarregarBytesAnexoOk = {
  ok: true
  bytes: Buffer
  filename: string
  contentType: string
}
export type CarregarBytesAnexoErro = { ok: false; erro: string; status: number }
export type CarregarBytesAnexoResultado = CarregarBytesAnexoOk | CarregarBytesAnexoErro

/**
 * Carrega os bytes de exatamente UM anexo do tenant: documentoId (bucket
 * `documentos`) XOR pecaId (peças → .docx em memória). Best-effort tipado: nunca
 * lança por regra de negócio — devolve { ok:false, erro, status } com o mesmo
 * status/mensagem que a rota original usava. O size limit (25 MB) é aplicado aqui.
 */
export async function carregarBytesAnexo(params: {
  supabase: SupabaseServer
  tenantId: string
  documentoId?: string
  pecaId?: string
}): Promise<CarregarBytesAnexoResultado> {
  const { supabase, tenantId, documentoId, pecaId } = params

  // Contrato: exatamente um dos dois. (As rotas já validam via zod refine; guarda
  // defensiva para uso direto do helper.)
  if (!!documentoId === !!pecaId) {
    return { ok: false, erro: 'Informe exatamente um: documentoId OU pecaId', status: 400 }
  }

  let bytes: Buffer
  let contentType: string
  let filename: string

  if (documentoId) {
    // RLS garante o tenant; ainda assim filtramos explicitamente.
    const { data: doc } = await supabase
      .from('documentos')
      .select('id, file_url, file_name, mime_type, tipo')
      .eq('id', documentoId)
      .eq('tenant_id', tenantId)
      .single()
    if (!doc || !doc.file_url) return { ok: false, erro: 'Documento não encontrado', status: 404 }

    contentType = tipoBase(doc.mime_type)
    if (!tipoAnexoPermitido(contentType)) {
      return { ok: false, erro: 'Tipo de documento não permitido para envio', status: 400 }
    }
    // Defesa em profundidade: o path do storage começa com o tenant do usuário.
    if (!String(doc.file_url).startsWith(`${tenantId}/`)) {
      return { ok: false, erro: 'Documento fora do tenant', status: 403 }
    }

    const admin = createAdminClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    )
    const { data: blob, error } = await admin.storage.from('documentos').download(doc.file_url)
    if (error || !blob) return { ok: false, erro: 'Falha ao baixar o documento', status: 502 }

    bytes = Buffer.from(await blob.arrayBuffer())
    // Sem file_name, o nome ficaria sem extensão e o WhatsApp não associaria a
    // um app: acrescenta a extensão canônica do MIME (ex.: contrato -> contrato.pdf).
    filename = doc.file_name ?? `${doc.tipo ?? 'documento'}${extensaoPorMime(contentType)}`
  } else {
    const { data: peca } = await supabase
      .from('pecas')
      .select('id, tipo, area, versao, conteudo_markdown')
      .eq('id', pecaId!)
      .eq('tenant_id', tenantId)
      .single()
    if (!peca) return { ok: false, erro: 'Peça não encontrada', status: 404 }
    if (!peca.conteudo_markdown) return { ok: false, erro: 'Peça sem conteúdo', status: 400 }

    const titulo = TIPOS_PECA[peca.tipo]?.nome ?? peca.tipo
    const estilo = await resolverEstiloEfetivo(supabase, tenantId, {
      tipo: 'peca',
      subtipo: peca.tipo,
    })
    let buffer = await markdownToDocx(peca.conteudo_markdown, { titulo, area: peca.area, estilo })

    // Aplica o papel timbrado do escritório, se houver (best-effort — igual ao export).
    const { data: timbrado } = await supabase.storage
      .from('documentos')
      .download(`${tenantId}/timbrado/timbrado.docx`)
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
    return { ok: false, erro: 'Documento excede o limite de 25 MB', status: 413 }
  }

  return { ok: true, bytes, filename, contentType }
}
