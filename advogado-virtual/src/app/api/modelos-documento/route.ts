import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

const TIPOS_VALIDOS = ['peca', 'contrato', 'procuracao', 'declaracao']

// GET /api/modelos-documento?tipo=peca — lista modelos do tenant
export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })

  const { data: usuario } = await supabase
    .from('users')
    .select('tenant_id')
    .eq('auth_user_id', user.id)
    .single()
  if (!usuario) return NextResponse.json({ error: 'Usuário não encontrado' }, { status: 404 })

  const tipo = req.nextUrl.searchParams.get('tipo')

  let query = supabase
    .from('modelos_documento')
    .select('id, tipo, titulo, descricao, created_at, updated_at')
    .eq('tenant_id', usuario.tenant_id)
    .order('tipo')
    .order('titulo')

  if (tipo && TIPOS_VALIDOS.includes(tipo)) {
    query = query.eq('tipo', tipo)
  }

  const { data: modelos } = await query
  return NextResponse.json({ modelos: modelos ?? [] })
}

// POST /api/modelos-documento — criar novo modelo
export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })

  const { data: usuario } = await supabase
    .from('users')
    .select('id, tenant_id, role')
    .eq('auth_user_id', user.id)
    .single()
  if (!usuario) return NextResponse.json({ error: 'Usuário não encontrado' }, { status: 404 })

  if (usuario.role !== 'admin' && usuario.role !== 'advogado') {
    return NextResponse.json({ error: 'Sem permissão' }, { status: 403 })
  }

  const formData = await req.formData()
  const tipo = formData.get('tipo') as string
  const titulo = formData.get('titulo') as string
  const descricao = formData.get('descricao') as string | null
  const arquivo = formData.get('arquivo') as File | null

  if (!tipo || !TIPOS_VALIDOS.includes(tipo)) {
    return NextResponse.json({ error: 'Tipo inválido' }, { status: 400 })
  }
  if (!titulo?.trim()) {
    return NextResponse.json({ error: 'Título é obrigatório' }, { status: 400 })
  }

  let conteudoMarkdown = ''
  let fileUrl: string | null = null

  if (arquivo && arquivo.size > 0) {
    const MAX_BYTES = 10 * 1024 * 1024
    if (arquivo.size > MAX_BYTES) {
      return NextResponse.json({ error: 'Arquivo muito grande (máx. 10 MB)' }, { status: 400 })
    }

    const arrayBuffer = await arquivo.arrayBuffer()
    const buffer = Buffer.from(arrayBuffer)

    // Upload para Storage
    const timestamp = Date.now()
    const ext = arquivo.name.split('.').pop()?.toLowerCase() ?? 'bin'
    const path = `${usuario.tenant_id}/modelos/${tipo}/${timestamp}_${arquivo.name}`

    const { error: uploadError } = await supabase.storage
      .from('documentos')
      .upload(path, buffer, { contentType: arquivo.type, upsert: true })

    if (uploadError) {
      return NextResponse.json({ error: `Upload falhou: ${uploadError.message}` }, { status: 500 })
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
      } else {
        // Texto puro
        conteudoMarkdown = new TextDecoder().decode(buffer).trim()
      }
    } catch (err) {
      console.error('[modelos-documento] Erro na extração:', err)
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
      titulo: titulo.trim(),
      descricao: descricao?.trim() || null,
      conteudo_markdown: conteudoMarkdown || null,
      file_url: fileUrl,
      created_by: usuario.id,
    })
    .select('id, tipo, titulo, descricao, created_at')
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ modelo }, { status: 201 })
}
