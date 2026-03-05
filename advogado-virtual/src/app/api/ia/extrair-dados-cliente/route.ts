import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { completionJSON } from '@/lib/anthropic/client'
import {
  SYSTEM_EXTRACAO,
  buildPromptExtracao,
  type DadosExtraidos,
} from '@/lib/prompts/extracao/dados-cliente'

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

    // Buscar documentos do atendimento
    const { data: documentos } = await supabase
      .from('documentos')
      .select('tipo, texto_extraido, file_name')
      .eq('atendimento_id', atendimentoId)
      .not('texto_extraido', 'is', null)

    if (!documentos?.length) {
      return NextResponse.json({ autor: {} } satisfies DadosExtraidos)
    }

    const prompt = buildPromptExtracao(
      documentos.map(d => ({
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
