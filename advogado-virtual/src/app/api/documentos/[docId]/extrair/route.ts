import { createClient as createAdminClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { getAuthContext } from '@/lib/auth'
import { jsonError } from '@/lib/api'
import { extrairTextoDeArquivo } from '@/lib/documentos/extrair-texto'

export const maxDuration = 60

// POST /api/documentos/[docId]/extrair — extrai texto SOB DEMANDA de um documento
// já no Storage e persiste em `texto_extraido`. Usado quando um doc do cadastro
// (que não passou pela extração no upload) entra no Estudo de Caso e precisa
// valer como contexto da análise. Idempotente: se já tem texto, devolve o
// existente sem reprocessar. LGPD: nunca loga conteúdo/nome (só ids).
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ docId: string }> },
) {
  const { docId } = await params
  const auth = await getAuthContext()
  if (!auth.ok) return auth.response
  const { supabase, usuario } = auth

  const { data: doc } = await supabase
    .from('documentos')
    .select('id, file_url, file_name, mime_type, texto_extraido')
    .eq('id', docId)
    .eq('tenant_id', usuario.tenant_id)
    .single()
  if (!doc) return jsonError('Documento não encontrado', 404)

  // Idempotência: texto já extraído → devolve sem reprocessar (não gasta tokens).
  const jaTem = (doc.texto_extraido ?? '').trim()
  if (jaTem) {
    return NextResponse.json({ documento: { id: doc.id, texto_extraido: jaTem } })
  }

  if (!doc.file_url) return jsonError('Documento sem arquivo no armazenamento', 400)

  // Baixa os bytes com o admin client (mesmo padrão da extração do upload).
  const admin = createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )
  const { data: fileData, error: downloadError } = await admin
    .storage.from('documentos')
    .download(doc.file_url)
  if (downloadError || !fileData) {
    return jsonError('Erro ao baixar arquivo para extração', 502)
  }

  const buffer = Buffer.from(await fileData.arrayBuffer())
  const texto = await extrairTextoDeArquivo(buffer, doc.mime_type, doc.file_name ?? '')

  // Persiste só quando há texto — sem texto, mantém null (a UI trata como aviso).
  if (texto) {
    await supabase
      .from('documentos')
      .update({ texto_extraido: texto })
      .eq('id', docId)
      .eq('tenant_id', usuario.tenant_id)
  }

  return NextResponse.json({ documento: { id: doc.id, texto_extraido: texto || null } })
}
