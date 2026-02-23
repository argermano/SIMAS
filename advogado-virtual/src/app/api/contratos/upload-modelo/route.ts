import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

// POST /api/contratos/upload-modelo — upload do modelo de contrato do advogado
// Extrai texto do PDF/DOCX e salva no Storage
export async function POST(req: NextRequest) {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })

  const { data: usuario } = await supabase
    .from('users')
    .select('id, tenant_id')
    .eq('auth_user_id', user.id)
    .single()

  if (!usuario) return NextResponse.json({ error: 'Usuário não encontrado' }, { status: 404 })

  const formData  = await req.formData()
  const arquivo   = formData.get('modelo') as File | null

  if (!arquivo) {
    return NextResponse.json({ error: 'Nenhum arquivo enviado' }, { status: 400 })
  }

  const TIPOS_ACEITOS = ['application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document']
  if (!TIPOS_ACEITOS.includes(arquivo.type)) {
    return NextResponse.json({ error: 'Apenas PDF e DOCX são suportados' }, { status: 400 })
  }

  const MAX_BYTES = 10 * 1024 * 1024 // 10 MB
  if (arquivo.size > MAX_BYTES) {
    return NextResponse.json({ error: 'Arquivo muito grande (máx. 10 MB)' }, { status: 400 })
  }

  const arrayBuffer = await arquivo.arrayBuffer()
  const buffer      = Buffer.from(arrayBuffer)

  // Upload para Storage
  const timestamp = Date.now()
  const ext       = arquivo.type.includes('pdf') ? 'pdf' : 'docx'
  const path      = `${usuario.tenant_id}/contratos/modelos/modelo_${timestamp}.${ext}`

  const { error: uploadError } = await supabase.storage
    .from('documentos')
    .upload(path, buffer, {
      contentType: arquivo.type,
      upsert: true,
    })

  if (uploadError) {
    return NextResponse.json({ error: `Upload falhou: ${uploadError.message}` }, { status: 500 })
  }

  // Extrai texto
  let textoExtraido = ''
  try {
    if (arquivo.type === 'application/pdf') {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const pdfMod  = await import('pdf-parse')
      const pdfParse = (pdfMod as any).default ?? pdfMod
      const parsed   = await pdfParse(buffer)
      textoExtraido  = parsed.text?.trim() ?? ''
    }
    // DOCX: extração básica — suporte futuro com mammoth.js
  } catch {
    // Falha silenciosa — retorna URL sem texto
  }

  return NextResponse.json({
    modelo_url:    path,
    texto_extraido: textoExtraido.substring(0, 8000), // Limita para evitar tokens excessivos
  })
}
