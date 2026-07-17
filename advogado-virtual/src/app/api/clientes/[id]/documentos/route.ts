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
import {
  agruparVinculosPorDoc,
  derivarLegado,
  type VinculoRow,
  type VinculoDoc,
} from '@/lib/documentos/vinculos'

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
// Cada doc traz `vinculos` (N:N, 063): as "pastas" (casos/processos) em que ele
// aparece — join em lote, sem N+1. Mantém os campos legado (1º vínculo de cada
// tipo) enquanto a UI atual não passa a consumir `vinculos` (fase UI).
// ?gerais=1 → só os GERAIS (SEM nenhum vínculo) — picker "Adicionar do cadastro".
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: clienteId } = await params
  const auth = await getAuthContext()
  if (!auth.ok) return auth.response
  const { supabase, usuario } = auth

  const soGerais = new URL(req.url).searchParams.get('gerais') === '1'

  const { data: docsRaw, error } = await supabase
    .from('documentos')
    // atendimento_id aqui é a ORIGEM (onde o doc nasceu — 063), não uma "pasta":
    // a árvore do dossiê usa para não deixar "remover da pasta de origem" um doc
    // que nasceu num caso (regra de origem.ts).
    .select('id, file_name, tipo, mime_type, tamanho_bytes, created_at, file_url, atendimento_id')
    .eq('tenant_id', usuario.tenant_id)
    .eq('cliente_id', clienteId)
    .not('file_url', 'is', null)
    .order('created_at', { ascending: false })
  if (error) return jsonError(error.message, 500)
  const docs = docsRaw ?? []

  // Vínculos em lote (join de caso/processo) → mapa documento_id → pastas.
  const ids = docs.map((d) => d.id)
  let mapa = new Map<string, VinculoDoc[]>()
  if (ids.length > 0) {
    const { data: vincRaw } = await supabase
      .from('documento_vinculos')
      .select('documento_id, atendimento_id, processo_id, atendimentos(titulo), processos(numero_cnj, apelido)')
      .eq('tenant_id', usuario.tenant_id)
      .in('documento_id', ids)
    mapa = agruparVinculosPorDoc((vincRaw ?? []) as VinculoRow[])
  }

  // ?gerais=1 = docs SEM nenhum vínculo (não estão em nenhuma pasta).
  const selecionados = soGerais ? docs.filter((d) => !mapa.has(d.id)) : docs

  // URLs assinadas curtas (1 h) geradas em lote para render imediato na lista.
  const urls = await Promise.all(
    selecionados.map((d) =>
      supabase.storage.from('documentos').createSignedUrl(d.file_url as string, 3600),
    ),
  )

  const documentos = selecionados.map((d, i) => {
    const vinculos = mapa.get(d.id) ?? []
    return {
      id:            d.id,
      file_name:     d.file_name,
      tipo:          d.tipo,
      mime_type:     d.mime_type,
      tamanho_bytes: d.tamanho_bytes,
      created_at:    d.created_at,
      // Legado (compat DocumentosDossie atual): 1º vínculo de cada tipo. Sem
      // vínculo = tudo null = doc GERAL (excluível aqui).
      ...derivarLegado(vinculos),
      // Contrato novo (árvore do dossiê): todas as pastas onde o doc está.
      vinculos,
      // Origem do doc (063): o caso onde ele nasceu (null se nasceu no dossiê).
      // A árvore não deixa "remover da pasta de origem" um doc nascido no caso.
      origem_atendimento_id: d.atendimento_id ?? null,
      url:           urls[i]?.data?.signedUrl ?? null,
    }
  })

  // Contratos do cliente como itens da árvore do dossiê (pedido do dono). NÃO são
  // linhas de `documentos` (contrato não é doc) — vão em campo próprio. Só no modo
  // árvore: o picker ?gerais=1 (adicionar do cadastro) não os usa. Assina em lote
  // (sem N+1) só os que têm PDF assinado importado no Storage; os demais ficam com
  // arquivoUrl null (a árvore navega para /contratos/[id]).
  let contratos: Array<{
    id: string; titulo: string; status: string; area: string | null
    atendimento_id: string | null; criado_em: string
    arquivoUrl: string | null; arquivoNome: string | null
  }> = []
  if (!soGerais) {
    const { data: contratosRaw } = await supabase
      .from('contratos_honorarios')
      .select('id, titulo, status, area, atendimento_id, created_at, arquivo_assinado_url, arquivo_assinado_nome')
      .eq('tenant_id', usuario.tenant_id)
      .eq('cliente_id', clienteId)
      .is('deleted_at', null)
      .order('created_at', { ascending: false })
    const base = contratosRaw ?? []
    const cUrls = await Promise.all(
      base.map((c) =>
        c.arquivo_assinado_url
          ? supabase.storage.from('documentos').createSignedUrl(c.arquivo_assinado_url, 3600)
          : Promise.resolve({ data: null }),
      ),
    )
    contratos = base.map((c, i) => ({
      id:             c.id,
      titulo:         c.titulo,
      status:         c.status,
      area:           c.area,
      atendimento_id: c.atendimento_id ?? null,
      criado_em:      c.created_at,
      arquivoUrl:     c.arquivo_assinado_url ? (cUrls[i]?.data?.signedUrl ?? null) : null,
      arquivoNome:    c.arquivo_assinado_nome ?? null,
    }))
  }

  return NextResponse.json({ documentos, contratos })
}
