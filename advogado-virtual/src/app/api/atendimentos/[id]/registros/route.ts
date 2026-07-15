import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getAuthContext } from '@/lib/auth'
import { jsonError, validateBody } from '@/lib/api'
import { logAudit } from '@/lib/audit'
import type { createClient } from '@/lib/supabase/server'

/**
 * Diário do atendimento/caso (tabela `atendimento_registros`, migr. 056).
 * APPEND-ONLY no v1: só lista (asc) e cria. Autor = usuário autenticado (nunca
 * vem do corpo). Escopo por tenant + atendimento.
 * LGPD: nunca logamos o conteúdo do registro — só ids na auditoria.
 */

type SupabaseServer = Awaited<ReturnType<typeof createClient>>

const schemaCreate = z.object({
  texto: z.string().trim().min(1).max(8000),
})

interface PessoaEmbed {
  id: string
  nome: string | null
}

interface RegistroRow {
  id: string
  texto: string
  created_at: string
  user_id: string | null
  users: PessoaEmbed | PessoaEmbed[] | null
}

function um<T>(v: T | T[] | null): T | null {
  return Array.isArray(v) ? (v[0] ?? null) : v
}

function normalizarAutor(row: RegistroRow): PessoaEmbed | null {
  const u = um(row.users)
  if (u) return { id: u.id, nome: u.nome }
  return row.user_id ? { id: row.user_id, nome: null } : null
}

const SELECT_REGISTRO = 'id, texto, created_at, user_id, users(id, nome)'

/** Confirma que o atendimento existe e pertence ao tenant (ignora soft-delete). */
async function atendimentoDoTenant(
  supabase: SupabaseServer,
  atendimentoId: string,
  tenantId: string,
): Promise<boolean> {
  const { data } = await supabase
    .from('atendimentos')
    .select('id')
    .eq('id', atendimentoId)
    .eq('tenant_id', tenantId)
    .is('deleted_at', null)
    .maybeSingle()
  return !!data
}

// GET /api/atendimentos/[id]/registros → { registros: [...] } (mais antigo primeiro)
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const auth = await getAuthContext()
  if (!auth.ok) return auth.response
  const { supabase, usuario } = auth

  if (!(await atendimentoDoTenant(supabase, id, usuario.tenant_id))) {
    return jsonError('Atendimento não encontrado', 404)
  }

  const { data, error } = await supabase
    .from('atendimento_registros')
    .select(SELECT_REGISTRO)
    .eq('atendimento_id', id)
    .eq('tenant_id', usuario.tenant_id)
    .order('created_at', { ascending: true })

  if (error) return jsonError(error.message, 500)

  const registros = ((data ?? []) as RegistroRow[]).map((row) => ({
    id: row.id,
    texto: row.texto,
    created_at: row.created_at,
    autor: normalizarAutor(row),
  }))

  return NextResponse.json({ registros })
}

// POST /api/atendimentos/[id]/registros → { registro: {...} }
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const auth = await getAuthContext()
  if (!auth.ok) return auth.response
  const { supabase, usuario } = auth

  const parsed = await validateBody(req, schemaCreate)
  if (!parsed.ok) return parsed.response

  if (!(await atendimentoDoTenant(supabase, id, usuario.tenant_id))) {
    return jsonError('Atendimento não encontrado', 404)
  }

  const { data, error } = await supabase
    .from('atendimento_registros')
    .insert({
      tenant_id: usuario.tenant_id,
      atendimento_id: id,
      user_id: usuario.id,
      texto: parsed.data.texto,
    })
    .select(SELECT_REGISTRO)
    .single()

  if (error) return jsonError(error.message, 500)
  const row = data as RegistroRow

  // Auditoria: só ids (LGPD — nunca o texto do registro).
  await logAudit({
    tenantId: usuario.tenant_id,
    userId: usuario.id,
    action: 'atendimento.registro_criado',
    resourceType: 'atendimento',
    resourceId: id,
    metadata: { registro_id: row.id },
  })

  return NextResponse.json(
    {
      registro: {
        id: row.id,
        texto: row.texto,
        created_at: row.created_at,
        autor: normalizarAutor(row) ?? { id: usuario.id, nome: usuario.nome },
      },
    },
    { status: 201 },
  )
}
