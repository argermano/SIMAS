import { NextRequest, NextResponse } from 'next/server'
import { getAuthContext, requireRole } from '@/lib/auth'
import { jsonError } from '@/lib/api'
import { detectarTipoReal } from '@/lib/file-validation'
import { extrairTexto, MAX_EXTRACT_BYTES } from '@/lib/documentos/extrair-texto'

// POST /api/contratos/upload-modelo — upload do modelo de contrato do advogado
// Extrai texto do PDF/DOCX e salva no Storage
export async function POST(req: NextRequest) {
  const auth = await getAuthContext()
  if (!auth.ok) return auth.response
  const { supabase, usuario } = auth

  // A8: configurar o modelo do escritório é ação de admin/advogado (as demais
  // rotas de contrato já exigem papel; esta só exigia autenticação).
  const semPermissao = requireRole(usuario, ['admin', 'advogado'])
  if (semPermissao) return semPermissao

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

  // Extrai texto do arquivo (PDF via pdf-parse, DOCX cru) pelo helper central.
  const { texto: textoExtraido } = await extrairTexto(buffer, {
    mime:     arquivo.type,
    fileName: arquivo.name,
    maxBytes: MAX_EXTRACT_BYTES,
    docx:     'raw',
  })

  console.log('[upload-modelo] tipo:', ext, '| texto extraído length:', textoExtraido.length)

  const LIMITE_MODELO = 8000
  const textoLimitado = textoExtraido.substring(0, LIMITE_MODELO)
  // Avisa (não silencioso) quando o modelo é maior que o teto — cláusulas finais
  // podem não entrar na geração via IA.
  const modeloTruncado = textoExtraido.length > LIMITE_MODELO
  if (modeloTruncado) {
    console.warn('[upload-modelo] modelo truncado', {
      tenant: usuario.tenant_id,
      original: textoExtraido.length,
      limite: LIMITE_MODELO,
    })
  }

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
    truncado:       modeloTruncado,
    ...(modeloTruncado && {
      aviso: `O modelo tem ${textoExtraido.length.toLocaleString('pt-BR')} caracteres e foi cortado em ${LIMITE_MODELO.toLocaleString('pt-BR')} — as cláusulas finais podem não entrar na geração via IA.`,
    }),
  })
}
