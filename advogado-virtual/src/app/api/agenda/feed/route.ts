import { randomBytes, randomUUID } from 'crypto'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { getAuthContext, requireRole } from '@/lib/auth'
import { jsonError, validateBody } from '@/lib/api'
import { logAudit } from '@/lib/audit'
import { urlBaseApp } from '@/lib/email'
import { PAPEIS_AGENDA } from '../eventos/_lib'

// Feed ICS pessoal — gestão do token (1 por usuário).
// GET  /api/agenda/feed  -> { url } (cria o token na 1ª chamada)
// POST /api/agenda/feed  { acao: "rotacionar" } -> { url } com token NOVO
//   (o link anterior é invalidado; logAudit SEM o token — token nunca é logado).
// A URL pública servida é <NEXTAUTH_URL>/api/agenda/ics/<token>.

/** Token opaco: uuid sem hifens + 32 bytes aleatórios em hex (96 chars). */
function gerarToken(): string {
  return `${randomUUID().replace(/-/g, '')}${randomBytes(32).toString('hex')}`
}

function urlDoFeed(token: string): string {
  return `${urlBaseApp().replace(/\/$/, '')}/api/agenda/ics/${token}`
}

export async function GET() {
  const auth = await getAuthContext()
  if (!auth.ok) return auth.response
  const { supabase, usuario } = auth

  const semPapel = requireRole(usuario, [...PAPEIS_AGENDA])
  if (semPapel) return semPapel

  const { data: existente, error: errSel } = await supabase
    .from('agenda_ics_tokens')
    .select('token')
    .eq('user_id', usuario.id)
    .maybeSingle()
  if (errSel) return jsonError('Falha ao consultar o feed', 500)
  if (existente?.token) return NextResponse.json({ url: urlDoFeed(existente.token) })

  // 1ª chamada: cria o token. Em corrida (PK user_id), relê o vencedor.
  const token = gerarToken()
  const { error: errIns } = await supabase
    .from('agenda_ics_tokens')
    .insert({ user_id: usuario.id, tenant_id: usuario.tenant_id, token })
  if (errIns) {
    const { data: corrida } = await supabase
      .from('agenda_ics_tokens')
      .select('token')
      .eq('user_id', usuario.id)
      .maybeSingle()
    if (corrida?.token) return NextResponse.json({ url: urlDoFeed(corrida.token) })
    return jsonError('Falha ao criar o link do feed', 500)
  }

  return NextResponse.json({ url: urlDoFeed(token) })
}

const schemaRotacionar = z.object({ acao: z.literal('rotacionar') })

export async function POST(req: Request) {
  const auth = await getAuthContext()
  if (!auth.ok) return auth.response
  const { supabase, usuario } = auth

  const semPapel = requireRole(usuario, [...PAPEIS_AGENDA])
  if (semPapel) return semPapel

  const parsed = await validateBody(req, schemaRotacionar)
  if (!parsed.ok) return parsed.response

  const token = gerarToken()
  const { error } = await supabase
    .from('agenda_ics_tokens')
    .upsert(
      {
        user_id: usuario.id,
        tenant_id: usuario.tenant_id,
        token,
        rotated_at: new Date().toISOString(),
      },
      { onConflict: 'user_id' },
    )
  if (error) return jsonError('Falha ao rotacionar o link do feed', 500)

  await logAudit({
    tenantId: usuario.tenant_id,
    userId: usuario.id,
    action: 'agenda_feed.rotacionar',
    resourceType: 'agenda_ics_token',
    resourceId: usuario.id,
  })

  return NextResponse.json({ url: urlDoFeed(token) })
}
