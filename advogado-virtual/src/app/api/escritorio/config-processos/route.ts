import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { getAuthContext, requireRole } from '@/lib/auth'
import { jsonError, validateBody } from '@/lib/api'
import { CATEGORIAS, categoriasNotificaveis, VIP_MAX } from '@/lib/processos/categorias'
import { normalizarOab } from '@/lib/processos/util'

const SLUGS = CATEGORIAS.map((c) => c.slug)

// UFs válidas (mesmo conjunto usado no perfil profissional).
const UFS_BR = ['AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS',
  'MG','PA','PB','PR','PE','PI','RJ','RN','RS','RO','RR','SC','SP','SE','TO']

function adminClient() {
  return createAdminClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
}

interface OabExtra {
  numero: string
  uf: string
  ativa?: boolean
}

// GET — categorias notificáveis + ocupação das vagas VIP + OABs monitoradas (DJEN)
export async function GET() {
  const auth = await getAuthContext()
  if (!auth.ok) return auth.response
  const { supabase, usuario } = auth

  const [{ data: tenant }, { data: vips }] = await Promise.all([
    supabase.from('tenants').select('config, oab_numero, oab_estado').eq('id', usuario.tenant_id).single(),
    supabase
      .from('clientes')
      .select('id, nome, aviso_movimentacao')
      .eq('tenant_id', usuario.tenant_id)
      .is('deleted_at', null)
      .neq('aviso_movimentacao', 'desligado')
      .order('nome'),
  ])
  const marcadas = categoriasNotificaveis(tenant?.config)

  // OABs monitoradas: principal (do perfil, readonly) + extras (config.djen_oabs)
  const cfg = (tenant?.config ?? {}) as { djen_oabs?: OabExtra[] }
  const oabPrincipal =
    tenant?.oab_numero && tenant?.oab_estado
      ? { numero: String(tenant.oab_numero), uf: String(tenant.oab_estado) }
      : null
  const djen = {
    oabPrincipal,
    extras: Array.isArray(cfg.djen_oabs) ? cfg.djen_oabs : [],
  }

  return NextResponse.json({
    categorias: CATEGORIAS.map((c) => ({ slug: c.slug, rotulo: c.rotulo, notificavel: marcadas.has(c.slug) })),
    vips: {
      total: (vips ?? []).length,
      max: VIP_MAX,
      clientes: (vips ?? []).map((v) => ({ id: v.id, nome: v.nome, modo: v.aviso_movimentacao })),
    },
    djen,
  })
}

const oabSchema = z.object({
  // O número é normalizado no handler (normalizarOab preserva letra de sufixo).
  numero: z.string().min(1).max(20).refine((v) => normalizarOab(v).length > 0, 'Número de OAB inválido'),
  uf: z.string().length(2).refine((v) => UFS_BR.includes(v.toUpperCase()), 'UF inválida'),
  ativa: z.boolean().optional(),
})

const schema = z.object({
  processos_notificar: z.array(z.enum(SLUGS as [string, ...string[]])).optional(),
  djen_oabs: z.array(oabSchema).max(10).optional(),
})

// PATCH — salva categorias notificáveis e/ou OABs monitoradas em tenants.config.
// admin/advogado. Merge preservando as demais chaves do config.
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
  const config: Record<string, unknown> = { ...(tenant?.config ?? {}) }

  if (parsed.data.processos_notificar !== undefined) {
    config.processos_notificar = parsed.data.processos_notificar
  }
  if (parsed.data.djen_oabs !== undefined) {
    // Normaliza o número (preserva letra de sufixo) e a UF; `ativa` default true.
    config.djen_oabs = parsed.data.djen_oabs.map((o) => ({
      numero: normalizarOab(o.numero),
      uf: o.uf.toUpperCase(),
      ativa: o.ativa ?? true,
    }))
  }

  const { error } = await admin.from('tenants').update({ config }).eq('id', usuario.tenant_id)
  if (error) return jsonError(error.message, 500)

  return NextResponse.json({
    ok: true,
    processos_notificar: config.processos_notificar,
    djen: { extras: config.djen_oabs ?? [] },
  })
}
