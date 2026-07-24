import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getAuthContext } from '@/lib/auth'
import { jsonError, validateBody } from '@/lib/api'
import { logAudit } from '@/lib/audit'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { apenasDigitos } from '@/lib/funil/telefone'
import { preferenciasEfetivas, podarParaGravar, type TipoNotificacao } from '@/lib/notificacoes/catalogo'

// Client service-role: o membro atualiza a PRÓPRIA linha (id fixado na sessão).
// Usamos admin (auth.uid()=null) para não esbarrar na RLS/trigger de privilégios
// e escrevemos SEMPRE com filtro id = sessão (mesmo padrão de /api/usuarios/[id]).
function adminDb() {
  return createAdminClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
}

// Celular do PRÓPRIO membro: aceita mascarado, guarda só dígitos; '' → null (limpar).
const celularSchema = z
  .string()
  .trim()
  .transform((s) => apenasDigitos(s))
  .refine((d) => d === '' || (d.length >= 10 && d.length <= 13), {
    message: 'Celular inválido (informe DDD + número)',
  })
  .transform((d) => (d === '' ? null : d))
  .nullable()
  .optional()

const canalSchema = z.object({ email: z.boolean(), whatsapp: z.boolean() })

const schemaPatch = z
  .object({
    nome: z.string().trim().min(1).max(200).optional(),
    celular: celularSchema,
    notificacoes: z
      .object({
        tarefa_atribuida: canalSchema,
        tarefa_comentario: canalSchema,
        resumo_diario: canalSchema,
      })
      .optional(),
  })
  .refine((d) => d.nome !== undefined || d.celular !== undefined || d.notificacoes !== undefined, {
    message: 'Nada para atualizar',
  })

// GET /api/perfil — dados do próprio usuário + preferências EFETIVAS de notificação.
export async function GET() {
  const auth = await getAuthContext()
  if (!auth.ok) return auth.response
  const { supabase, usuario } = auth

  const { data, error } = await supabase
    .from('users')
    .select('id, nome, email, celular, unidade, notificacoes')
    .eq('id', usuario.id)
    .maybeSingle()

  if (error) return jsonError(error.message, 500)
  if (!data) return jsonError('Usuário não encontrado', 404)

  return NextResponse.json({
    usuario: {
      id: data.id,
      nome: data.nome,
      email: data.email,
      celular: data.celular,
      unidade: data.unidade,
      // Resolve o mapa cru nos defaults do catálogo → a UI mostra o estado efetivo.
      notificacoes: preferenciasEfetivas(data.notificacoes),
    },
  })
}

// PATCH /api/perfil — o usuário edita nome, celular e preferências de notificação.
export async function PATCH(req: NextRequest) {
  const auth = await getAuthContext()
  if (!auth.ok) return auth.response
  const { usuario } = auth

  const parsed = await validateBody(req, schemaPatch)
  if (!parsed.ok) return parsed.response
  const { nome, celular, notificacoes } = parsed.data

  const patch: Record<string, unknown> = {}
  if (nome !== undefined) patch.nome = nome
  if (celular !== undefined) patch.celular = celular
  // Grava só o que difere do default (defaults moram no código — ver 081).
  if (notificacoes !== undefined) {
    patch.notificacoes = podarParaGravar(notificacoes as Record<TipoNotificacao, { email: boolean; whatsapp: boolean }>)
  }

  const db = adminDb()
  const { data, error } = await db
    .from('users')
    .update(patch)
    .eq('id', usuario.id)
    .eq('tenant_id', usuario.tenant_id)
    .select('id, nome, email, celular, unidade, notificacoes')
    .single()

  if (error || !data) return jsonError('Falha ao salvar o perfil', 500)

  // LGPD: audita só ids/flags — nunca o número nem o conteúdo das preferências.
  await logAudit({
    tenantId: usuario.tenant_id,
    userId: usuario.id,
    action: 'perfil.update',
    resourceType: 'user',
    resourceId: usuario.id,
    metadata: {
      nome: nome !== undefined,
      celular: celular !== undefined ? (celular === null ? 'removido' : 'atualizado') : undefined,
      notificacoes: notificacoes !== undefined,
    },
  })

  return NextResponse.json({
    usuario: {
      id: data.id,
      nome: data.nome,
      email: data.email,
      celular: data.celular,
      unidade: data.unidade,
      notificacoes: preferenciasEfetivas(data.notificacoes),
    },
  })
}
