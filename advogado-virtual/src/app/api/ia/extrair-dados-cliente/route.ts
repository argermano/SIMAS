import { NextRequest, NextResponse } from 'next/server'
import { getAuthContext } from '@/lib/auth'
import { jsonError } from '@/lib/api'
import { completionJSON, DEFAULT_MODEL } from '@/lib/anthropic/client'
import { extrairTexto, MAX_EXTRACT_BYTES } from '@/lib/documentos/extrair-texto'
import { safeLogUsage } from '@/lib/anthropic/usage'
import { logger } from '@/lib/logger'
import {
  SYSTEM_EXTRACAO,
  buildPromptExtracao,
  type DadosExtraidos,
} from '@/lib/prompts/extracao/dados-cliente'

export const maxDuration = 120

// POST /api/ia/extrair-dados-cliente
export async function POST(req: NextRequest) {
  const start = Date.now()
  try {
    const { atendimentoId } = await req.json() as { atendimentoId: string }

    if (!atendimentoId) {
      return jsonError('atendimentoId é obrigatório', 400)
    }

    const auth = await getAuthContext()
    if (!auth.ok) return auth.response
    const { supabase, usuario } = auth

    // Buscar TODOS os documentos do atendimento (incluindo sem texto)
    const { data: documentos } = await supabase
      .from('documentos')
      .select('id, tipo, texto_extraido, file_name, file_url, mime_type')
      .eq('atendimento_id', atendimentoId)

    if (!documentos?.length) {
      return NextResponse.json({ autor: {} } satisfies DadosExtraidos)
    }

    // Processar documentos que não têm texto_extraido (enviados antes do OCR)
    for (const doc of documentos) {
      if (doc.texto_extraido?.trim()) continue
      if (!doc.file_url || !doc.mime_type) continue

      try {
        const { data: fileData } = await supabase.storage
          .from('documentos')
          .download(doc.file_url)

        if (!fileData) continue

        const arrayBuffer = await fileData.arrayBuffer()
        // Teto único (pula docs acima de MAX_EXTRACT_BYTES) + fallback OCR centralizados.
        const { texto } = await extrairTexto(Buffer.from(arrayBuffer), {
          mime:     doc.mime_type,
          fileName: doc.file_name ?? '',
          maxBytes: MAX_EXTRACT_BYTES,
          ocr:      true,
        })

        if (texto.trim()) {
          doc.texto_extraido = texto
          // Atualiza no banco para não precisar reprocessar
          await supabase
            .from('documentos')
            .update({ texto_extraido: texto })
            .eq('id', doc.id)
        }
      } catch {
        // Falha silenciosa — continua com próximo documento
      }
    }

    // Filtrar apenas documentos com texto
    const docsComTexto = documentos.filter(d => d.texto_extraido?.trim())

    if (!docsComTexto.length) {
      return NextResponse.json({ autor: {} } satisfies DadosExtraidos)
    }

    const prompt = buildPromptExtracao(
      docsComTexto.map(d => ({
        tipo:            d.tipo,
        texto_extraido:  d.texto_extraido ?? '',
        file_name:       d.file_name,
      }))
    )

    const { result, usage } = await completionJSON<DadosExtraidos>({
      system:    SYSTEM_EXTRACAO,
      prompt,
      maxTokens: 2048,
    })

    // Registra o uso no dashboard (a extração estruturada; o OCR Haiku por
    // documento não é contabilizado aqui — só a chamada principal).
    await safeLogUsage({
      tenantId: usuario.tenant_id,
      userId: usuario.id,
      endpoint: 'extrair_dados',
      modelo: DEFAULT_MODEL,
      tokensInput: usage.input,
      tokensOutput: usage.output,
      latenciaMs: Date.now() - start,
    })

    return NextResponse.json(result)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Erro desconhecido'
    logger.error('ia.extrair_dados_cliente.falha', {}, err)
    return jsonError(message, 500)
  }
}
