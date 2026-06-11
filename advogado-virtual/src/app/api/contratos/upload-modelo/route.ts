import { NextRequest, NextResponse } from 'next/server'
import { getAuthContext } from '@/lib/auth'
import { jsonError } from '@/lib/api'
import { detectarTipoReal } from '@/lib/file-validation'

// POST /api/contratos/upload-modelo — upload do modelo de contrato do advogado
// Extrai texto do PDF/DOCX e salva no Storage
export async function POST(req: NextRequest) {
  const auth = await getAuthContext()
  if (!auth.ok) return auth.response
  const { supabase, usuario } = auth

  const formData  = await req.formData()
  const arquivo   = formData.get('modelo') as File | null

  if (!arquivo) {
    return jsonError('Nenhum arquivo enviado', 400)
  }

  const TIPOS_ACEITOS = ['application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document']
  if (!TIPOS_ACEITOS.includes(arquivo.type)) {
    return jsonError('Apenas PDF e DOCX são suportados', 400)
  }

  const MAX_BYTES = 10 * 1024 * 1024 // 10 MB
  if (arquivo.size > MAX_BYTES) {
    return jsonError('Arquivo muito grande (máx. 10 MB)', 400)
  }

  const arrayBuffer = await arquivo.arrayBuffer()
  const buffer      = Buffer.from(arrayBuffer)

  // Valida o conteúdo real (magic bytes) — não confiar no file.type do cliente
  const tipoReal = detectarTipoReal(buffer)
  const tipoEsperado = arquivo.type === 'application/pdf' ? 'pdf' : 'zip' // DOCX = contêiner ZIP
  if (tipoReal !== tipoEsperado) {
    return jsonError('O conteúdo do arquivo não corresponde ao tipo declarado (PDF ou DOCX).', 400)
  }

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
    return jsonError(`Upload falhou: ${uploadError.message}`, 500)
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
