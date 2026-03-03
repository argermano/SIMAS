import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { markdownToDocx } from '@/lib/export/docx-generator'

// POST /api/exportar-documento — gerar DOCX a partir de markdown raw (sem pecaId)
export async function POST(req: NextRequest) {
  try {
    const { conteudo, titulo } = await req.json() as { conteudo: string; titulo?: string }

    if (!conteudo?.trim()) {
      return NextResponse.json({ error: 'Conteúdo obrigatório' }, { status: 400 })
    }

    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })

    const buffer = await markdownToDocx(conteudo, { titulo })
    const fileName = `${(titulo ?? 'documento').replace(/\s+/g, '_')}.docx`

    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'Content-Disposition': `attachment; filename="${fileName}"`,
      },
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Erro desconhecido'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
