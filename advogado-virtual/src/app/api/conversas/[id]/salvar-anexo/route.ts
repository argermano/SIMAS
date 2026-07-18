import { NextRequest, NextResponse } from 'next/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { randomUUID } from 'crypto'
import { z } from 'zod'
import { getAuthContext, requireRole } from '@/lib/auth'
import { jsonError, validateBody } from '@/lib/api'
import { logAudit } from '@/lib/audit'
import { logger } from '@/lib/logger'
import { relayFetchBinario } from '@/lib/conversas/relay'
import { enfileirarDriveSync } from '@/lib/drive/fila'

// Client service-role só para o gatilho do espelho (drive_sync_fila é service-only).
const driveAdmin = () =>
  createAdminClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
import {
  TIPOS_ANEXO_PERMITIDOS,
  LIMITE_ANEXO_SERVIDOR_BYTES,
  tipoBase,
  mimePorNomeArquivo,
  extensaoPorMime,
} from '@/lib/conversas/anexos'

// Mídia segura do WhatsApp (paridade com o proxy /api/conversas/anexos) e a
// extensão do arquivo salvo — dossiê aceita qualquer anexo da conversa.
const MIMES_MIDIA = new Map<string, string>([
  ['audio/ogg', '.ogg'], ['audio/mpeg', '.mp3'], ['audio/mp4', '.m4a'],
  ['audio/aac', '.aac'], ['audio/amr', '.amr'], ['audio/wav', '.wav'],
  ['video/mp4', '.mp4'], ['video/3gpp', '.3gp'],
])

const schema = z.object({
  anexoUrl: z.string().url().max(2000),
  fileName: z.string().max(300).optional(),
  clienteId: z.string().uuid(),
  atendimentoId: z.string().uuid().optional(),
})

/** Último segmento (nome) do path de uma URL, se houver (fallback ao nome do anexo). */
function nomeDaUrl(url: string): string | null {
  try {
    const p = new URL(url).pathname
    const seg = decodeURIComponent(p.split('/').filter(Boolean).pop() ?? '')
    return seg || null
  } catch {
    return null
  }
}

// POST /api/conversas/[id]/salvar-anexo — salva um ANEXO da conversa (entrada ou
// saída) como DOCUMENTO no dossiê do CLIENTE, opcionalmente vinculado a um caso.
// Baixa os bytes server-side pelo relay (MESMA barreira SSRF do proxy de anexos —
// a validação da URL é do relay; o RELAY_TOKEN nunca chega ao cliente), revalida
// tipo/tamanho na allowlist de DOCUMENTOS (áudio/vídeo ficam de fora) e sobe no
// prefixo do próprio cliente. LGPD: auditoria só com ids/contagens.
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await getAuthContext()
  if (!auth.ok) return auth.response
  const gate = requireRole(auth.usuario, ['admin', 'advogado', 'colaborador'])
  if (gate) return gate
  const { supabase, usuario } = auth
  const tenantId = usuario.tenant_id

  const email = auth.user.email
  if (!email) return jsonError('E-mail do usuário ausente na sessão', 400)

  const { id } = await params
  // id do Chatwoot é numérico (consistência com as demais rotas da conversa).
  if (!/^\d+$/.test(id)) return jsonError('Conversa inválida', 400)

  const parsed = await validateBody(req, schema)
  if (!parsed.ok) return parsed.response
  const { anexoUrl, fileName, clienteId, atendimentoId } = parsed.data

  // Cliente precisa existir no tenant (posse do doc + prefixo do path).
  const { data: cliente } = await supabase
    .from('clientes')
    .select('id')
    .eq('id', clienteId)
    .eq('tenant_id', tenantId)
    .is('deleted_at', null)
    .single()
  if (!cliente) return jsonError('Cliente não encontrado', 404)

  // Caso (opcional): precisa ser do MESMO cliente e tenant (senão 403/404).
  if (atendimentoId) {
    const { data: caso } = await supabase
      .from('atendimentos')
      .select('id, cliente_id')
      .eq('id', atendimentoId)
      .eq('tenant_id', tenantId)
      .is('deleted_at', null)
      .single()
    if (!caso) return jsonError('Caso não encontrado', 404)
    if (caso.cliente_id !== clienteId) return jsonError('O caso pertence a outro cliente.', 403)
  }

  // Baixa os bytes do anexo pelo relay (mesmo proxy usado para exibir a mídia).
  const origem = await relayFetchBinario('/attachments', {
    method: 'GET',
    email,
    query: { url: anexoUrl },
  })
  if (origem.status !== 200 || !origem.buffer) {
    return jsonError('Não foi possível baixar o anexo', origem.status)
  }
  if (origem.buffer.length > LIMITE_ANEXO_SERVIDOR_BYTES) {
    return jsonError('Anexo excede o limite de 25 MB', 413)
  }

  const nome = fileName?.trim() || nomeDaUrl(anexoUrl) || 'anexo'

  // Tipo confiável = o do relay; fallback à extensão do nome (o Chatwoot guarda
  // docs como octet-stream). Além da allowlist de DOCUMENTOS, aceita a MÍDIA
  // segura do WhatsApp (mesma lista do proxy de anexos) — o dono quer poder
  // salvar QUALQUER anexo da conversa no dossiê, áudios/vídeos inclusive.
  let mime = tipoBase(origem.contentType)
  if (!TIPOS_ANEXO_PERMITIDOS.has(mime) && !MIMES_MIDIA.has(mime)) {
    const porNome = mimePorNomeArquivo(nome)
    if (porNome) mime = porNome
  }
  if (!TIPOS_ANEXO_PERMITIDOS.has(mime) && !MIMES_MIDIA.has(mime)) {
    return jsonError('Tipo de arquivo não permitido', 400)
  }

  // Path: <tenant>/clientes/<cliente>/<uuid><.ext> (prefixo do tenant = RLS do bucket).
  const path = `${tenantId}/clientes/${clienteId}/${randomUUID()}${MIMES_MIDIA.get(mime) ?? extensaoPorMime(mime)}`
  const { error: upErr } = await supabase.storage
    .from('documentos')
    .upload(path, origem.buffer, { contentType: mime })
  if (upErr) return jsonError(`Falha ao salvar o documento: ${upErr.message}`, 500)

  const { data: documento, error: insErr } = await supabase
    .from('documentos')
    .insert({
      atendimento_id: null, // nasce no dossiê (a partir da conversa), não num caso
      cliente_id:     clienteId,
      tenant_id:      tenantId,
      tipo:           'outro',
      file_url:       path,
      file_name:      nome,
      mime_type:      mime,
      tamanho_bytes:  origem.buffer.length,
    })
    .select('id')
    .single()
  if (insErr || !documento) {
    // Não deixa arquivo órfão no bucket se a linha não persistiu.
    await supabase.storage.from('documentos').remove([path])
    return jsonError(insErr?.message ?? 'Falha ao salvar o documento', 500)
  }

  // Vínculo opcional ao caso (N:N, 063) — idempotente (UNIQUE parcial barra corrida).
  if (atendimentoId) {
    const { error: vincErr } = await supabase
      .from('documento_vinculos')
      .insert({ tenant_id: tenantId, documento_id: documento.id, atendimento_id: atendimentoId })
    // 23505 = já existe (ok). Outro erro só loga: o doc já está no dossiê do cliente.
    if (vincErr && vincErr.code !== '23505') {
      logger.error('conversas.salvar_anexo.vinculo', { documentoId: documento.id, code: vincErr.code })
    }
  }

  await logAudit({
    tenantId,
    userId: usuario.id,
    action: 'conversas.anexo_salvo',
    resourceType: 'documento',
    resourceId: documento.id,
    metadata: {
      cliente_id: clienteId,
      atendimento_id: atendimentoId ?? null,
      conversa_id: id,
      tamanho: origem.buffer.length,
    },
  })

  // Anexo virou documento do dossiê → reespelha o cliente no Drive.
  await enfileirarDriveSync(driveAdmin(), tenantId, clienteId)

  return NextResponse.json({ documentoId: documento.id }, { status: 201 })
}
