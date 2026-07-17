import { NextRequest, NextResponse } from 'next/server'
import { getAuthContext, requireRole } from '@/lib/auth'
import { jsonError } from '@/lib/api'
import { relayFetchBinario } from '@/lib/conversas/relay'

// GET /api/conversas/anexos?url= — proxy BINÁRIO de anexo (imagem/áudio/vídeo/
// arquivo) do Chatwoot via relay, para <img>/<audio>/<video>/nova aba do browser.
// Exige sessão (mesmos papéis do módulo de
// conversas); o RELAY_TOKEN nunca chega ao cliente. Degrade gracioso: erro do
// relay (inclusive 404 ATTACHMENTS_DISABLED) é repassado como status — a UI cai
// no card de anexo atual via onError.
//
// SEGURANÇA: o conteúdo é controlado pelo CONTATO EXTERNO da conversa e a UI
// abre o anexo em nova aba (ou <audio>/<video> inline) na MESMA ORIGEM do app.
// Só repassamos Content-Types seguros para render inline (nunca SVG/HTML/XML —
// script embutido rodaria com a sessão do usuário); mídia (áudio/vídeo do
// WhatsApp) é inerte, então liberamos os codecs que o WhatsApp entrega. Fora da
// allowlist vira download (octet-stream + attachment). nosniff e CSP sandbox sempre.
const TIPOS_INLINE = new Set([
  // Imagens + PDF (preview inline e comprovante).
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'application/pdf',
  // Áudio (WhatsApp entrega ogg/opus; demais codecs comuns de voz/mídia).
  'audio/ogg',
  'audio/mpeg',
  'audio/mp4',
  'audio/aac',
  'audio/amr',
  'audio/wav',
  // Vídeo (mp4 do WhatsApp; 3gpp de gravações antigas).
  'video/mp4',
  'video/3gpp',
])

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
  const total = buffer.length

  const headersBase: Record<string, string> = {
    'Content-Type': inline ? tipo : 'application/octet-stream',
    ...(inline ? {} : { 'Content-Disposition': 'attachment' }),
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': 'sandbox',
    'Cache-Control': 'private, max-age=300',
    // <audio>/<video> pedem faixa (Range) para descobrir a duração e permitir
    // seek; anunciamos suporte para o browser nem tentar baixar tudo de uma vez.
    'Accept-Ranges': 'bytes',
  }

  // Range: o WebKit (Safari) EXIGE 206 quando envia `Range: bytes=...`; se
  // respondermos 200 com o arquivo inteiro, ele recusa a mídia e dispara o
  // onError do <audio> — que na UI cai no card de download. Servimos a fatia.
  const range = req.headers.get('range')
  const m = range ? /^bytes=(\d*)-(\d*)$/.exec(range.trim()) : null
  if (m && (m[1] !== '' || m[2] !== '')) {
    let start: number
    let end: number
    if (m[1] === '') {
      // Sufixo `bytes=-N`: os últimos N bytes.
      const n = Number(m[2])
      start = Math.max(0, total - n)
      end = total - 1
    } else {
      start = Number(m[1])
      end = m[2] === '' ? total - 1 : Math.min(Number(m[2]), total - 1)
    }
    if (!Number.isFinite(start) || start > end || start >= total) {
      return new NextResponse(null, {
        status: 416,
        headers: {
          'Content-Range': `bytes */${total}`,
          'Accept-Ranges': 'bytes',
          'X-Content-Type-Options': 'nosniff',
          'Content-Security-Policy': 'sandbox',
        },
      })
    }
    const fatia = buffer.subarray(start, end + 1)
    return new NextResponse(new Uint8Array(fatia), {
      status: 206,
      headers: {
        ...headersBase,
        'Content-Range': `bytes ${start}-${end}/${total}`,
        'Content-Length': String(fatia.length),
      },
    })
  }

  return new NextResponse(new Uint8Array(buffer), {
    status: 200,
    headers: { ...headersBase, 'Content-Length': String(total) },
  })
}
