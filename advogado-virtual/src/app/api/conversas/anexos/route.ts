import { NextRequest, NextResponse } from 'next/server'
import { getAuthContext, requireRole } from '@/lib/auth'
import { jsonError } from '@/lib/api'
import { relayFetchBinario } from '@/lib/conversas/relay'

// GET /api/conversas/anexos?url= — proxy BINÁRIO de anexo (imagem) do Chatwoot
// via relay, para o <img> do browser. Exige sessão (mesmos papéis do módulo de
// conversas); o RELAY_TOKEN nunca chega ao cliente. Degrade gracioso: erro do
// relay (inclusive 404 ATTACHMENTS_DISABLED) é repassado como status — a UI cai
// no card de anexo atual via onError.
//
// SEGURANÇA: o conteúdo é controlado pelo CONTATO EXTERNO da conversa e a UI
// abre o anexo em nova aba na MESMA ORIGEM do app. Só repassamos Content-Types
// seguros para render inline (nunca SVG/HTML — script embutido rodaria com a
// sessão do usuário); fora da allowlist vira download (octet-stream +
// attachment). nosniff e CSP sandbox sempre.
const TIPOS_INLINE = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'application/pdf'])

export async function GET(req: NextRequest) {
  const auth = await getAuthContext()
  if (!auth.ok) return auth.response
  const gate = requireRole(auth.usuario, ['admin', 'advogado', 'colaborador'])
  if (gate) return gate

  const email = auth.user.email
  if (!email) return jsonError('E-mail do usuário ausente na sessão', 400)

  const url = new URL(req.url).searchParams.get('url')
  if (!url) return jsonError('Parâmetro "url" é obrigatório', 400)

  const { status, buffer, contentType } = await relayFetchBinario('/attachments', {
    method: 'GET',
    email,
    query: { url },
  })

  if (status !== 200 || !buffer) {
    // Repassa o status do relay (404 attachments desligado, 502/503, etc.).
    return new NextResponse(null, { status })
  }

  const tipo = (contentType ?? '').split(';')[0].trim().toLowerCase()
  const inline = TIPOS_INLINE.has(tipo)

  return new NextResponse(new Uint8Array(buffer), {
    status: 200,
    headers: {
      'Content-Type': inline ? tipo : 'application/octet-stream',
      ...(inline ? {} : { 'Content-Disposition': 'attachment' }),
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': 'sandbox',
      'Cache-Control': 'private, max-age=300',
    },
  })
}
