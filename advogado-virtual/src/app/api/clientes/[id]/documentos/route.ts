import { createClient as createAdminClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { randomUUID } from 'crypto'
import { getAuthContext } from '@/lib/auth'
import { jsonError } from '@/lib/api'
import {
  TIPOS_ANEXO_PERMITIDOS,
  LIMITE_ANEXO_SERVIDOR_BYTES,
  tipoBase,
  mimePorNomeArquivo,
  extensaoPorMime,
} from '@/lib/conversas/anexos'

// Documentos anexados DIRETO ao dossiê do cliente (sem atendimento). Upload em 2
// passos (mesmo padrão dos docs de atendimento): (1) POST { fileName, fileType,
// fileSize } devolve signed upload URL; o navegador envia ao Storage; (2) POST
// { storagePath, ... } confirma — conferimos o tamanho REAL no Storage e criamos
// a linha em `documentos`. Contorna o limite de body (~4.5 MB) da função Vercel.

const admin = () =>
  createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )

// Resolve o MIME efetivo dentro da allowlist (o navegador às vezes dá '' p/ .docx).
function mimeEfetivo(fileType: string, fileName: string): string | null {
  let mime = tipoBase(fileType)
  if (!TIPOS_ANEXO_PERMITIDOS.has(mime)) {
    const porNome = mimePorNomeArquivo(fileName)
    if (porNome) mime = porNome
  }
  return TIPOS_ANEXO_PERMITIDOS.has(mime) ? mime : null
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: clienteId } = await params
  const auth = await getAuthContext()
  if (!auth.ok) return auth.response
  const { supabase, usuario } = auth

  // Cliente precisa existir no tenant (posse do doc + prefixo do path).
  const { data: cliente } = await supabase
    .from('clientes')
    .select('id')
    .eq('id', clienteId)
    .eq('tenant_id', usuario.tenant_id)
    .is('deleted_at', null)
    .single()
  if (!cliente) return jsonError('Cliente não encontrado', 404)

  const body = (await req.json().catch(() => null)) as
    | { fileName?: string; fileType?: string; fileSize?: number; storagePath?: string; tipo?: string }
    | null
  if (!body) return jsonError('Corpo da requisição inválido', 400)

  // ── Passo 2: confirmação (tem storagePath) ──────────────────────────────
  if (typeof body.storagePath === 'string' && body.storagePath) {
    const storagePath = body.storagePath
    const prefixo = `${usuario.tenant_id}/clientes/${clienteId}/`
    // Defesa em profundidade: só confirma paths do próprio cliente/tenant.
    if (!storagePath.startsWith(prefixo)) {
      return jsonError('Caminho de arquivo inválido', 400)
    }

    const mime = mimeEfetivo(body.fileType ?? '', body.fileName ?? '')
    if (!mime) return jsonError('Tipo de arquivo não permitido', 400)

    // Confere o tamanho REAL no Storage (nunca confiar no fileSize do cliente).
    const nomeArquivo = storagePath.slice(prefixo.length)
    const pasta = prefixo.replace(/\/$/, '')
    const { data: itens, error: listErr } = await admin()
      .storage.from('documentos')
      .list(pasta, { search: nomeArquivo, limit: 100 })
    if (listErr) return jsonError('Falha ao confirmar o upload', 502)
    const item = (itens ?? []).find((f) => f.name === nomeArquivo)
    if (!item) return jsonError('Arquivo não encontrado no armazenamento', 404)

    const tamanhoReal = Number(item.metadata?.size ?? 0)
    if (tamanhoReal <= 0) return jsonError('Arquivo vazio ou inválido', 400)
    if (tamanhoReal > LIMITE_ANEXO_SERVIDOR_BYTES) {
      // Remove o arquivo já enviado para não deixar lixo acima do teto no bucket.
      await admin().storage.from('documentos').remove([storagePath])
      return jsonError('Arquivo excede o limite de 25 MB', 413)
    }

    const { data: documento, error: insertError } = await supabase
      .from('documentos')
      .insert({
        atendimento_id: null,
        cliente_id:     clienteId,
        tenant_id:      usuario.tenant_id,
        tipo:           typeof body.tipo === 'string' && body.tipo ? body.tipo : 'outro',
        file_url:       storagePath,
        file_name:      body.fileName ?? nomeArquivo,
        mime_type:      mime,
        tamanho_bytes:  tamanhoReal,
      })
      .select('id, file_name, tipo, mime_type, tamanho_bytes, created_at, atendimento_id')
      .single()

    if (insertError) {
      await admin().storage.from('documentos').remove([storagePath])
      return jsonError(insertError.message, 500)
    }
    return NextResponse.json({ documento }, { status: 201 })
  }

  // ── Passo 1: preparar (gera signed upload URL) ──────────────────────────
  const { fileName, fileType, fileSize } = body
  if (!fileName || typeof fileSize !== 'number') {
    return jsonError('Dados do arquivo são obrigatórios', 400)
  }
  if (fileSize > LIMITE_ANEXO_SERVIDOR_BYTES) {
    return jsonError(`Arquivo "${fileName}" excede o limite de 25 MB`, 413)
  }
  const mime = mimeEfetivo(fileType ?? '', fileName)
  if (!mime) return jsonError('Tipo de arquivo não permitido', 400)

  // Path: <tenant>/clientes/<cliente>/<uuid><.ext> (prefixo do tenant = RLS do bucket).
  const ext = extensaoPorMime(mime)
  const path = `${usuario.tenant_id}/clientes/${clienteId}/${randomUUID()}${ext}`

  const { data: signed, error: signErr } = await admin()
    .storage.from('documentos')
    .createSignedUploadUrl(path)
  if (signErr || !signed) {
    return jsonError(`Erro ao gerar URL de upload: ${signErr?.message}`, 500)
  }

  return NextResponse.json(
    { uploadUrl: signed.signedUrl, uploadToken: signed.token, storagePath: path },
    { status: 201 },
  )
}

// GET /api/clientes/[id]/documentos — lista os docs do cliente (diretos +
// herdados de atendimentos via cliente_id) com signed URLs curtas para abrir.
// ?gerais=1 → só os GERAIS (sem vínculo de caso nem de processo) — usado pelo
// picker "Adicionar do cadastro" na tela do caso.
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: clienteId } = await params
  const auth = await getAuthContext()
  if (!auth.ok) return auth.response
  const { supabase, usuario } = auth

  const soGerais = new URL(req.url).searchParams.get('gerais') === '1'

  let query = supabase
    .from('documentos')
    .select('id, file_name, tipo, mime_type, tamanho_bytes, created_at, atendimento_id, processo_id, file_url, atendimentos(titulo), processos(numero_cnj, apelido)')
    .eq('tenant_id', usuario.tenant_id)
    .eq('cliente_id', clienteId)
    .not('file_url', 'is', null)
  if (soGerais) query = query.is('atendimento_id', null).is('processo_id', null)

  const { data, error } = await query.order('created_at', { ascending: false })
  if (error) return jsonError(error.message, 500)

  const linhas = data ?? []
  // URLs assinadas curtas (1 h) geradas em lote para render imediato na lista.
  const urls = await Promise.all(
    linhas.map((d) =>
      supabase.storage.from('documentos').createSignedUrl(d.file_url as string, 3600),
    ),
  )

  const documentos = linhas.map((d, i) => {
    const at = Array.isArray(d.atendimentos) ? d.atendimentos[0] : d.atendimentos
    const pr = Array.isArray(d.processos) ? d.processos[0] : d.processos
    return {
      id:            d.id,
      file_name:     d.file_name,
      tipo:          d.tipo,
      mime_type:     d.mime_type,
      tamanho_bytes: d.tamanho_bytes,
      created_at:    d.created_at,
      // atendimento_id/processo_id null (ambos) = doc GERAL (excluível aqui).
      atendimento_id: d.atendimento_id,
      atendimento_titulo: (at as { titulo?: string } | null)?.titulo ?? null,
      processo_id:    d.processo_id,
      processo_numero_cnj: (pr as { numero_cnj?: string } | null)?.numero_cnj ?? null,
      processo_apelido:    (pr as { apelido?: string } | null)?.apelido ?? null,
      url:           urls[i]?.data?.signedUrl ?? null,
    }
  })

  return NextResponse.json({ documentos })
}
