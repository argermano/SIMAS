import { NextResponse } from 'next/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { z } from 'zod'
import { getAuthContext, requireRole } from '@/lib/auth'
import { jsonError, validateBody } from '@/lib/api'
import {
  caminhoAnexoEnvio,
  validarAnexoParaEnvio,
} from '@/lib/conversas/anexos'

const schema = z.object({
  filename: z.string().min(1).max(300),
  mimetype: z.string().max(200),
  tamanho: z.number().int().positive(),
})

// POST /api/conversas/[id]/anexo/preparar — prepara o envio de um ARQUIVO DO PC:
// valida tipo/tamanho e devolve uma URL assinada para o browser subir o binário
// DIRETO ao Storage. O arquivo nunca passa pelo corpo de uma função Vercel (teto
// ~4,5 MB) — o passo seguinte (POST .../anexo) só recebe o storagePath.
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await getAuthContext()
  if (!auth.ok) return auth.response
  const gate = requireRole(auth.usuario, ['admin', 'advogado', 'colaborador'])
  if (gate) return gate
  const { usuario } = auth

  const { id } = await params
  // Ids do Chatwoot são numéricos: guarda antes de interpolar no path do Storage.
  if (!/^\d+$/.test(id)) return jsonError('Conversa inválida', 400)

  const parsed = await validateBody(req, schema)
  if (!parsed.ok) return parsed.response
  const { filename, mimetype, tamanho } = parsed.data

  const guard = validarAnexoParaEnvio({ filename, mimetype, tamanho })
  if (!guard.ok) return jsonError(guard.erro, guard.status)

  // Path na área temporária DESTE tenant (o prefixo é revalidado no envio).
  const storagePath = caminhoAnexoEnvio(usuario.tenant_id, id, filename)

  const admin = createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )
  const { data: signed, error } = await admin.storage
    .from('documentos')
    .createSignedUploadUrl(storagePath)
  if (error || !signed) {
    return jsonError('Falha ao preparar o upload', 500)
  }

  return NextResponse.json({
    uploadUrl: signed.signedUrl,
    token: signed.token,
    storagePath,
  })
}
