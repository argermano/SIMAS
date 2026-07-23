import { NextResponse } from 'next/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { getAuthContext } from '@/lib/auth'
import { jsonError } from '@/lib/api'
import { carregarEstiloTenant } from '@/lib/format/estilo-documento'
import { gerarDocxComTimbrado, DOCX_MIME } from '@/lib/export/gerar-docx'
import { enfileirarDriveSync } from '@/lib/drive/fila'

// Client service-role só para o gatilho do espelho (drive_sync_fila é service-only).
const driveAdmin = () =>
  createAdminClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

// Documentos curtos que devem caber em uma única página (espaçamento compacto)
const TIPOS_COMPACTOS = new Set([
  'procuracao',
  'declaracao',
  'declaracao_hipossuficiencia',
  'substabelecimento',
])

// Contratos/notificações: denso (multi-página) com fecho/assinaturas centralizados
const TIPOS_CONTRATO = new Set([
  'contrato',
  'contrato_honorarios',
  'notificacao',
  'notificacao_extrajudicial',
])

// POST /api/atendimentos/[id]/documentos/anexar-gerado
// Gera o .docx a partir do markdown (estilo do escritório + papel timbrado, se houver)
// e ANEXA ao caso (tabela documentos), aparecendo em "Documentos do Caso".
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const auth = await getAuthContext()
  if (!auth.ok) return auth.response
  const { supabase, usuario } = auth

  const { tipo, titulo, conteudo, documentoId } = (await req.json().catch(() => ({}))) as {
    tipo?: string
    titulo?: string
    conteudo?: string
    documentoId?: string | null
  }
  if (!conteudo?.trim()) return jsonError('Conteúdo obrigatório', 400)

  const { data: atendimento } = await supabase
    .from('atendimentos')
    .select('id, cliente_id')
    .eq('id', id)
    .eq('tenant_id', usuario.tenant_id)
    .single()
  if (!atendimento) return jsonError('Atendimento não encontrado', 404)

  // Gera o .docx (mesmo pipeline do export) e aplica o papel timbrado, se houver
  const estilo = await carregarEstiloTenant(supabase, usuario.tenant_id)
  const buffer = await gerarDocxComTimbrado(supabase, usuario.tenant_id, {
    conteudo, titulo, estilo,
    compacto: TIPOS_COMPACTOS.has(tipo ?? ''),
    contrato: TIPOS_CONTRATO.has(tipo ?? ''),
  })

  const base = (titulo ?? 'documento').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-zA-Z0-9._-]/g, '_')
  const fileName = `${base}.docx`
  const path = `${usuario.tenant_id}/${id}/docs/${Date.now()}_${fileName}`

  const { error: upErr } = await supabase.storage
    .from('documentos')
    .upload(path, buffer, { contentType: DOCX_MIME, upsert: true })
  if (upErr) return jsonError(`Falha ao salvar o documento: ${upErr.message}`, 500)

  // Idempot\u00eancia: se j\u00e1 existe um documento (mesmo "Salvar" clicado de novo),
  // ATUALIZA o registro em vez de criar outro \u2014 evita duplicar no caso.
  if (documentoId) {
    const { data: existente } = await supabase
      .from('documentos')
      .select('id, file_url')
      .eq('id', documentoId)
      .eq('atendimento_id', id)
      .eq('tenant_id', usuario.tenant_id)
      .maybeSingle()

    if (existente) {
      const { data: documento, error } = await supabase
        .from('documentos')
        .update({
          tipo: tipo ?? 'outro',
          file_url: path,
          file_name: fileName,
          mime_type: DOCX_MIME,
          tamanho_bytes: buffer.length,
          texto_extraido: conteudo.slice(0, 5000),
        })
        .eq('id', documentoId)
        .eq('tenant_id', usuario.tenant_id)
        .select()
        .single()

      if (error) return jsonError(error.message, 500)
      // Remove o arquivo antigo do storage (best-effort)
      if (existente.file_url && existente.file_url !== path) {
        await supabase.storage.from('documentos').remove([existente.file_url])
      }
      // Conteúdo/nome do doc mudou → reespelha o cliente (renomeia/reenvia no Drive).
      await enfileirarDriveSync(driveAdmin(), usuario.tenant_id, atendimento.cliente_id)
      return NextResponse.json({ documento }, { status: 200 })
    }
  }

  const { data: documento, error } = await supabase
    .from('documentos')
    .insert({
      atendimento_id: id,
      cliente_id: atendimento.cliente_id ?? null,
      tenant_id: usuario.tenant_id,
      tipo: tipo ?? 'outro',
      file_url: path,
      file_name: fileName,
      mime_type: DOCX_MIME,
      tamanho_bytes: buffer.length,
      texto_extraido: conteudo.slice(0, 5000),
    })
    .select()
    .single()

  if (error) return jsonError(error.message, 500)

  // Nasce já "na pasta" do caso: cria a linha de vínculo N:N (063) além da origem
  // (atendimento_id) — é por ela que a tela do caso lista os documentos. (O ramo
  // de UPDATE acima não precisa: o doc já nasceu aqui, então já tem o vínculo.)
  const { error: vincErr } = await supabase
    .from('documento_vinculos')
    .insert({ tenant_id: usuario.tenant_id, documento_id: documento.id, atendimento_id: id })
  // LGPD: sem nome de arquivo no log — só id do doc e código do erro.
  if (vincErr) console.error('[anexar-gerado] vínculo falhou:', documento.id, vincErr.code)

  // Documento gerado anexado ao caso → reespelha o cliente no Drive.
  await enfileirarDriveSync(driveAdmin(), usuario.tenant_id, atendimento.cliente_id)

  return NextResponse.json({ documento }, { status: 201 })
}
