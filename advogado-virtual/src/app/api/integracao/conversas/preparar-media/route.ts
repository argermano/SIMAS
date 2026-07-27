import { NextResponse } from 'next/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { jsonError, validateBody } from '@/lib/api'
import { autorizadoIntegracao } from '@/lib/funil/auth-integracao'
import { logger } from '@/lib/logger'
import { prepararMediaSchema } from '@/lib/conversas-acervo/contrato'
import { caminhoMediaAcervo, validarMediaAcervo } from '@/lib/conversas-acervo/normalizar'

// POST /api/integracao/conversas/preparar-media — o encaminhador do VPS baixa a
// mídia da Evolution (getBase64) e precisa de um lugar para colocá-la. Aqui ele
// recebe uma URL ASSINADA de upload; o binário sobe DIRETO ao Storage (bucket
// privado `documentos`) e NUNCA passa pelo corpo de uma função Vercel (~4,5 MB).
// Depois o VPS manda o evento com media.storagePath (ver .../conversas/eventos).
//
// Auth: x-simas-token + FUNIL_TENANT_ID (mesmo padrão das demais /api/integracao;
// o middleware já isenta o prefixo inteiro de redirect para /login).
// Teto: 40 MB. Tipo de arquivo LIVRE — isto é ACERVO: o que o cliente mandou
// tem de ser guardado como veio (a allowlist existe no caminho de ENVIO).
export async function POST(req: Request) {
  if (!autorizadoIntegracao(req)) {
    return new NextResponse('Unauthorized', { status: 401 })
  }

  const tenantId = process.env.FUNIL_TENANT_ID
  if (!tenantId) return jsonError('FUNIL_TENANT_ID não configurado', 500)

  const parsed = await validateBody(req, prepararMediaSchema)
  if (!parsed.ok) return parsed.response
  const { instancia, mensagemId, conversaJid, filename, tamanho } = parsed.data

  const guard = validarMediaAcervo({ tamanho })
  if (!guard.ok) return jsonError(guard.erro, guard.status)

  // Path sempre dentro do prefixo DESTE tenant, com todos os segmentos
  // sanitizados (anti-traversal). A ingestão revalida o prefixo antes de gravar.
  const storagePath = caminhoMediaAcervo({
    tenantId,
    instancia,
    conversaJid,
    mensagemId,
    filename,
  })

  const admin = createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )
  // upsert: true porque o path é DETERMINÍSTICO (<msgId>_<nome>) e o encaminhador
  // re-tenta o fluxo inteiro quando o POST de eventos falha. Sem isto, o segundo
  // preparar-media do MESMO arquivo bate em "resource already exists" (o Storage
  // recusa assinar sobre objeto existente) → 500 em loop, ou mídia marcada como
  // pendente mesmo já estando no bucket. Sobrescrever o mesmo objeto é inócuo:
  // é o mesmo binário da mesma mensagem, dentro do prefixo deste tenant.
  const { data: signed, error } = await admin.storage
    .from('documentos')
    .createSignedUploadUrl(storagePath, { upsert: true })
  if (error || !signed) {
    // 500 → o encaminhador re-tenta; se desistir, manda o evento com
    // media: { pendente: true, motivo } e a mensagem não se perde.
    logger.warn('conversas_acervo.preparar_media_falhou', { instancia, mensagemId })
    return jsonError('Falha ao preparar o upload', 500)
  }

  return NextResponse.json({
    uploadUrl: signed.signedUrl,
    token: signed.token,
    storagePath,
  })
}
