// Upload de um documento do caso a partir do navegador — o MESMO fluxo em três
// passos do painel de documentos (UploadDocumentos): pedir a URL assinada,
// mandar os bytes direto ao Storage (o limite de 4,5 MB da Vercel não permite
// passar o arquivo pela rota) e disparar a extração de texto.
//
// Diferença única em relação ao painel: aqui a extração é AGUARDADA. Quem chama
// é o clipe do chat da sessão de lapidação, e um documento sem texto extraído
// entraria na rodada seguinte como um nome de arquivo vazio.

import { createClient } from '@/lib/supabase/client'

export const MAX_UPLOAD_BYTES = 50 * 1024 * 1024

export interface DocumentoSubido {
  id: string
  file_name: string
  tipo: string
  texto_extraido?: string | null
}

export type ResultadoUpload =
  | { ok: true; documento: DocumentoSubido }
  | { ok: false; erro: string }

export async function subirDocumentoDoCaso(params: {
  atendimentoId: string
  arquivo: File
  /** Categoria do dossiê; o chat sobe como 'outro' (o advogado reclassifica depois). */
  tipo?: string
}): Promise<ResultadoUpload> {
  const { atendimentoId, arquivo } = params

  if (arquivo.size > MAX_UPLOAD_BYTES) {
    return { ok: false, erro: `"${arquivo.name}" passa do limite de 50 MB.` }
  }

  try {
    const res = await fetch(`/api/atendimentos/${atendimentoId}/documentos`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fileName: arquivo.name,
        fileType: arquivo.type || 'application/octet-stream',
        fileSize: arquivo.size,
        tipo: params.tipo ?? 'outro',
      }),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      return { ok: false, erro: (data as { error?: string }).error ?? 'Não foi possível preparar o envio.' }
    }

    const { error: erroUpload } = await createClient()
      .storage.from('documentos')
      .uploadToSignedUrl(data.storagePath as string, data.uploadToken as string, arquivo, {
        contentType: arquivo.type || 'application/octet-stream',
      })
    if (erroUpload) return { ok: false, erro: `Falha ao enviar o arquivo: ${erroUpload.message}` }

    const documento = data.documento as DocumentoSubido

    // Extração aguardada (best-effort): se falhar, o documento já existe no
    // dossiê e pode ser anexado assim mesmo — só não trará texto à rodada.
    try {
      const resExtrair = await fetch(`/api/atendimentos/${atendimentoId}/documentos`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ documentoId: documento.id, fileType: arquivo.type }),
      })
      if (resExtrair.ok) {
        const extraido = await resExtrair.json().catch(() => null)
        const texto = extraido?.documento?.texto_extraido as string | undefined
        if (texto) documento.texto_extraido = texto
      }
    } catch {
      /* extração é complementar — o upload já valeu */
    }

    return { ok: true, documento }
  } catch {
    return { ok: false, erro: 'Falha de rede ao enviar o arquivo.' }
  }
}
