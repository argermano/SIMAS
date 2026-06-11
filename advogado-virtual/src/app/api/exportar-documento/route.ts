import { NextRequest, NextResponse } from 'next/server'
import { getAuthContext } from '@/lib/auth'
import { jsonError } from '@/lib/api'
import { markdownToDocx } from '@/lib/export/docx-generator'

// POST /api/exportar-documento — gerar DOCX a partir de markdown raw (sem pecaId)
export async function POST(req: NextRequest) {
  try {
    const { conteudo, titulo } = await req.json() as { conteudo: string; titulo?: string }

    if (!conteudo?.trim()) {
      return jsonError('Conteúdo obrigatório', 400)
    }

    const auth = await getAuthContext()
    if (!auth.ok) return auth.response

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
    return jsonError(message, 500)
  }
}
