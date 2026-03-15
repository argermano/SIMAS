import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { completionJSON, extractTextFromImage, extractTextFromPdf } from '@/lib/anthropic/client'
import {
  SYSTEM_EXTRACAO,
  buildPromptExtracao,
  type DadosExtraidos,
} from '@/lib/prompts/extracao/dados-cliente'

const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp']

// POST /api/ia/extrair-dados-cliente
export async function POST(req: NextRequest) {
  try {
    const { atendimentoId } = await req.json() as { atendimentoId: string }

    if (!atendimentoId) {
      return NextResponse.json({ error: 'atendimentoId é obrigatório' }, { status: 400 })
    }

    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })

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
        let texto = ''

        if (IMAGE_TYPES.includes(doc.mime_type)) {
          const base64 = Buffer.from(arrayBuffer).toString('base64')
          texto = await extractTextFromImage({
            imageBase64: base64,
            mediaType: doc.mime_type as 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp',
          })
        } else if (doc.mime_type === 'application/pdf') {
          // Tenta pdf-parse primeiro
          try {
            const { PDFParse } = await import('pdf-parse')
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const parser = new PDFParse(new Uint8Array(arrayBuffer)) as any
            await parser.load()
            const result = await parser.getText()
            texto = (result as { pages: Array<{ text: string }> }).pages
              .map((p: { text: string }) => p.text)
              .join('\n\n')
              .trim()
          } catch { /* ignore */ }

          // Se pouco texto, tenta via Claude Document
          if (texto.replace(/\s+/g, '').length < 50) {
            const base64 = Buffer.from(arrayBuffer).toString('base64')
            texto = await extractTextFromPdf({ pdfBase64: base64 })
          }
        }

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

    const { result } = await completionJSON<DadosExtraidos>({
      system:    SYSTEM_EXTRACAO,
      prompt,
      maxTokens: 2048,
    })

    return NextResponse.json(result)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Erro desconhecido'
    console.error('[extrair-dados-cliente]', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
