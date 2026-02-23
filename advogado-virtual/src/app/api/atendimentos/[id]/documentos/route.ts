import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

// POST /api/atendimentos/[id]/documentos — upload de documento + extração de texto
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })

  const { data: usuario } = await supabase
    .from('users')
    .select('tenant_id')
    .eq('auth_user_id', user.id)
    .single()

  if (!usuario) return NextResponse.json({ error: 'Usuário não encontrado' }, { status: 404 })

  // Verifica se o atendimento pertence ao tenant
  const { data: atendimento } = await supabase
    .from('atendimentos')
    .select('id, cliente_id')
    .eq('id', id)
    .eq('tenant_id', usuario.tenant_id)
    .single()

  if (!atendimento) {
    return NextResponse.json({ error: 'Atendimento não encontrado' }, { status: 404 })
  }

  const formData = await req.formData()
  const arquivo = formData.get('arquivo') as File | null
  const tipo = (formData.get('tipo') as string) || 'outro'

  if (!arquivo) {
    return NextResponse.json({ error: 'Nenhum arquivo enviado' }, { status: 400 })
  }

  try {
    // 1. Upload para Supabase Storage
    const timestamp = Date.now()
    const nomeSeguro = arquivo.name.replace(/[^a-zA-Z0-9._-]/g, '_')
    const path = `${usuario.tenant_id}/${id}/docs/${timestamp}_${nomeSeguro}`
    const arrayBuffer = await arquivo.arrayBuffer()

    const { error: uploadError } = await supabase.storage
      .from('documentos')
      .upload(path, arrayBuffer, {
        contentType: arquivo.type || 'application/octet-stream',
      })

    if (uploadError) {
      return NextResponse.json({ error: `Upload falhou: ${uploadError.message}` }, { status: 500 })
    }

    // 2. Extração de texto para PDFs
    let textoExtraido = ''

    if (arquivo.type === 'application/pdf') {
      try {
        const pdfMod = await import('pdf-parse')
        const pdfParse = (pdfMod as unknown as { default: (buf: Buffer) => Promise<{ text: string }> }).default ?? pdfMod
        const buffer = Buffer.from(arrayBuffer)
        const pdfData = await (pdfParse as (buf: Buffer) => Promise<{ text: string }>)(buffer)
        textoExtraido = pdfData.text ?? ''
      } catch {
        textoExtraido = '[Erro ao extrair texto do PDF]'
      }
    }

    // 3. Insere na tabela documentos
    const { data: documento, error: insertError } = await supabase
      .from('documentos')
      .insert({
        atendimento_id: id,
        cliente_id:     atendimento.cliente_id ?? null,
        tenant_id:      usuario.tenant_id,
        tipo,
        file_url:       path,
        file_name:      arquivo.name,
        mime_type:      arquivo.type,
        tamanho_bytes:  arquivo.size,
        texto_extraido: textoExtraido || null,
      })
      .select()
      .single()

    if (insertError) {
      return NextResponse.json({ error: insertError.message }, { status: 500 })
    }

    return NextResponse.json({ documento }, { status: 201 })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Erro desconhecido'
    return NextResponse.json({ error: `Erro no upload: ${message}` }, { status: 500 })
  }
}
