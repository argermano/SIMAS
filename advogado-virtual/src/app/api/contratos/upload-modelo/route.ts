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

  // Extrai texto do arquivo
  let textoExtraido = ''
  try {
    if (arquivo.type === 'application/pdf') {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const pdfParse = require('pdf-parse/lib/pdf-parse.js') as (buf: Buffer) => Promise<{ text: string }>
      const pdfData = await pdfParse(buffer)
      textoExtraido = pdfData.text?.trim() ?? ''
    } else {
      // DOCX: extração com mammoth
      const mammoth = await import('mammoth')
      const result  = await mammoth.extractRawText({ buffer })
      textoExtraido = result.value?.trim() ?? ''
    }
  } catch (err) {
    console.error('[upload-modelo] Erro na extração de texto:', err)
  }

  console.log('[upload-modelo] tipo:', ext, '| texto extraído length:', textoExtraido.length)

  const textoLimitado = textoExtraido.substring(0, 8000)

  // Salvar como template no banco para uso futuro
  let templateId: string | null = null
  if (textoLimitado) {
    const nomeModelo = arquivo.name.replace(/\.(pdf|docx)$/i, '') || 'Contrato de Honorários'
    const { data: template } = await supabase
      .from('templates_contrato')
      .insert({
        tenant_id: usuario.tenant_id,
        titulo: nomeModelo,
        conteudo_markdown: textoLimitado,
        created_by: usuario.id,
      })
      .select('id')
      .single()
    templateId = template?.id ?? null
  }

  return NextResponse.json({
    modelo_url:     path,
    texto_extraido: textoLimitado,
    template_id:    templateId,
  })
}
