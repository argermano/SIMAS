import { NextRequest, NextResponse } from 'next/server'
import { getAuthContext } from '@/lib/auth'
import { jsonError } from '@/lib/api'
import { extrairEstiloDocx } from '@/lib/modelos/extrair-estilo-docx'
import { extrairTextoDocx, templatizarDocx } from '@/lib/modelos/templatizar-docx'
import { detectarPlaceholders } from '@/lib/modelos/detectar-placeholders'

const TIPOS_VALIDOS = ['peca', 'contrato', 'procuracao', 'declaracao', 'substabelecimento']

// Tipos que viram template preenchível (.docx com placeholders) automaticamente
const NOME_TIPO_TEMPLATE: Record<string, string> = {
  contrato: 'contrato',
  procuracao: 'procuração',
  declaracao: 'declaração',
  substabelecimento: 'substabelecimento',
}

// GET /api/modelos-documento?tipo=peca — lista modelos do tenant
export async function GET(req: NextRequest) {
  const auth = await getAuthContext()
  if (!auth.ok) return auth.response
  const { supabase, usuario } = auth

  const tipo = req.nextUrl.searchParams.get('tipo')

  let query = supabase
    .from('modelos_documento')
    .select('id, tipo, subtipo, titulo, descricao, created_at, updated_at')
    .eq('tenant_id', usuario.tenant_id)
    .order('tipo')
    .order('subtipo')

  if (tipo && TIPOS_VALIDOS.includes(tipo)) {
    query = query.eq('tipo', tipo)
  }

  const { data: modelos } = await query
  return NextResponse.json({ modelos: modelos ?? [] })
}

// POST /api/modelos-documento — criar novo modelo
export async function POST(req: NextRequest) {
  const auth = await getAuthContext()
  if (!auth.ok) return auth.response
  const { supabase, usuario } = auth

  if (usuario.role !== 'admin' && usuario.role !== 'advogado') {
    return jsonError('Sem permissão', 403)
  }

  const formData = await req.formData()
  const tipo = formData.get('tipo') as string
  const subtipo = (formData.get('subtipo') as string) || 'todos'
  const titulo = formData.get('titulo') as string
  const descricao = formData.get('descricao') as string | null
  const arquivo = formData.get('arquivo') as File | null

  if (!tipo || !TIPOS_VALIDOS.includes(tipo)) {
    return jsonError('Tipo inválido', 400)
  }
  if (!titulo?.trim()) {
    return jsonError('Título é obrigatório', 400)
  }

  let conteudoMarkdown = ''
  let fileUrl: string | null = null
  let estiloConfig: Awaited<ReturnType<typeof extrairEstiloDocx>> = null
  let placeholdersDetectados: string[] = []

  if (arquivo && arquivo.size > 0) {
    const MAX_BYTES = 10 * 1024 * 1024
    if (arquivo.size > MAX_BYTES) {
      return jsonError('Arquivo muito grande (máx. 10 MB)', 400)
    }

    const arrayBuffer = await arquivo.arrayBuffer()
    const buffer = Buffer.from(arrayBuffer)

    // Upload para Storage
    const timestamp = Date.now()
    const ext = arquivo.name.split('.').pop()?.toLowerCase() ?? 'bin'

    // .doc (formato antigo) não é suportado para extração/preenchimento
    if (ext === 'doc') {
      return jsonError(
        'Envie o documento em .docx (no Word: Arquivo → Salvar como → Documento do Word .docx). O formato .doc antigo não é suportado.',
        400,
      )
    }

    // Nome seguro para a chave do Storage (sem acentos/caracteres especiais)
    const nomeSeguro = arquivo.name
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')   // remove acentos (diacríticos)
      .replace(/[^a-zA-Z0-9._-]/g, '_')  // só caracteres seguros na chave
    const path = `${usuario.tenant_id}/modelos/${tipo}/${timestamp}_${nomeSeguro}`

    const { error: uploadError } = await supabase.storage
      .from('documentos')
      .upload(path, buffer, { contentType: arquivo.type, upsert: true })

    if (uploadError) {
      return jsonError(`Upload falhou: ${uploadError.message}`, 500)
    }
    fileUrl = path

    // Extrair texto
    try {
      if (arquivo.type === 'application/pdf' || ext === 'pdf') {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const pdfParse = require('pdf-parse/lib/pdf-parse.js') as (buf: Buffer) => Promise<{ text: string }>
        const pdfData = await pdfParse(buffer)
        conteudoMarkdown = pdfData.text?.trim() ?? ''
      } else if (
        arquivo.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
        ext === 'docx'
      ) {
        const mammoth = await import('mammoth')
        const result = await mammoth.extractRawText({ buffer })
        conteudoMarkdown = result.value?.trim() ?? ''
        // Extrai o estilo real do .docx (fonte/margens/entrelinha/cabeçalho)
        estiloConfig = await extrairEstiloDocx(buffer)
      } else {
        // Texto puro
        conteudoMarkdown = new TextDecoder().decode(buffer).trim()
      }
    } catch (err) {
      console.error('[modelos-documento] Erro na extração:', err)
    }

    // Cria o template automaticamente: a IA detecta os valores variáveis do .docx
    // (exemplo preenchido) e os troca por {{placeholders}}, preservando a formatação.
    // Invisível para o usuário — ele sobe o documento normal.
    const ehDocx =
      arquivo.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' || ext === 'docx'
    if (ehDocx && NOME_TIPO_TEMPLATE[tipo]) {
      try {
        const texto = extrairTextoDocx(buffer)
        // só se houver texto e ainda não for um template (sem {{...}} manual)
        if (texto.trim().length > 30 && !texto.includes('{{')) {
          const pares = await detectarPlaceholders(texto, NOME_TIPO_TEMPLATE[tipo])
          if (pares.length > 0) {
            const { buffer: template, aplicados } = templatizarDocx(buffer, pares)
            if (aplicados > 0) {
              await supabase.storage
                .from('documentos')
                .upload(path, template, { contentType: arquivo.type, upsert: true })
              placeholdersDetectados = [...new Set(pares.map((p) => p.replace))]
            }
          }
        }
      } catch (err) {
        console.error('[modelos-documento] templatização automática falhou:', err)
      }
    }
  } else {
    // Conteúdo inserido manualmente
    const conteudo = formData.get('conteudo') as string | null
    conteudoMarkdown = conteudo?.trim() ?? ''
  }

  const { data: modelo, error } = await supabase
    .from('modelos_documento')
    .insert({
      tenant_id: usuario.tenant_id,
      tipo,
      subtipo,
      titulo: titulo.trim(),
      descricao: descricao?.trim() || null,
      conteudo_markdown: conteudoMarkdown || null,
      estilo_config: estiloConfig,
      file_url: fileUrl,
      created_by: usuario.id,
    })
    .select('id, tipo, subtipo, titulo, descricao, created_at')
    .single()

  if (error) return jsonError(error.message, 500)

  const ehDocxTemplatizavel = !!fileUrl && !!NOME_TIPO_TEMPLATE[tipo] && /\.docx$/i.test(fileUrl)
  return NextResponse.json(
    {
      modelo,
      templatizacao: ehDocxTemplatizavel
        ? { placeholders: placeholdersDetectados, total: placeholdersDetectados.length }
        : null,
    },
    { status: 201 },
  )
}
