import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { getAuthContext, requireRole } from '@/lib/auth'
import { jsonError, validateBody } from '@/lib/api'
import { CATEGORIAS, categoriasNotificaveis } from '@/lib/processos/categorias'

const SLUGS = CATEGORIAS.map((c) => c.slug)

function adminClient() {
  return createAdminClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
}

// GET — categorias e quais estão marcadas como notificáveis para o tenant
export async function GET() {
  const auth = await getAuthContext()
  if (!auth.ok) return auth.response
  const { supabase, usuario } = auth

  const { data: tenant } = await supabase.from('tenants').select('config').eq('id', usuario.tenant_id).single()
  const marcadas = categoriasNotificaveis(tenant?.config)
  return NextResponse.json({
    categorias: CATEGORIAS.map((c) => ({ slug: c.slug, rotulo: c.rotulo, notificavel: marcadas.has(c.slug) })),
  })
}

const schema = z.object({
  processos_notificar: z.array(z.enum(SLUGS as [string, ...string[]])),
})

// PATCH — salva o conjunto de categorias notificáveis em tenants.config. admin/advogado.
export async function PATCH(req: Request) {
  const auth = await getAuthContext()
  if (!auth.ok) return auth.response
  const { usuario } = auth
  const gate = requireRole(usuario, ['admin', 'advogado'])
  if (gate) return gate

  const parsed = await validateBody(req, schema)
  if (!parsed.ok) return parsed.response

  const admin = adminClient()
  // Merge preservando o restante do config existente
  const { data: tenant } = await admin.from('tenants').select('config').eq('id', usuario.tenant_id).single()
  const config = { ...(tenant?.config ?? {}), processos_notificar: parsed.data.processos_notificar }

  const { error } = await admin.from('tenants').update({ config }).eq('id', usuario.tenant_id)
  if (error) return jsonError(error.message, 500)

  return NextResponse.json({ ok: true, processos_notificar: parsed.data.processos_notificar })
}
