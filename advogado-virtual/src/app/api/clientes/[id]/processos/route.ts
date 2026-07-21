import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { getAuthContext } from '@/lib/auth'
import { jsonError, validateBody } from '@/lib/api'
import { logAudit } from '@/lib/audit'
import { validarNumeroCNJ, aliasDataJud } from '@/lib/jurisprudencia/verificador-citacoes'
import { sincronizarProcessoPorId } from '@/lib/processos/sync'
import { religarPublicacoes } from '@/lib/processos/djen'

export const maxDuration = 60 // sync imediato no cadastro (DataJud ~7s + resumos IA)

const schemaProcesso = z.object({
  numero: z.string().min(15).max(30),
  apelido: z.string().max(120).optional().nullable(),
})

function adminClient() {
  return createAdminClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
}

// GET /api/clientes/[id]/processos — lista os processos vinculados a um cliente
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await getAuthContext()
  if (!auth.ok) return auth.response
  const { supabase, usuario } = auth
  const { id: clienteId } = await params

  const { data, error } = await supabase
    .from('processos')
    .select('*')
    .eq('tenant_id', usuario.tenant_id)
    .eq('cliente_id', clienteId)
    .order('created_at', { ascending: false })

  if (error) return jsonError(error.message, 500)
  return NextResponse.json({ processos: data ?? [] })
}

// POST /api/clientes/[id]/processos — vincula um processo (por nº CNJ) e sincroniza
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await getAuthContext()
  if (!auth.ok) return auth.response
  const { supabase, usuario } = auth
  const { id: clienteId } = await params

  const parsed = await validateBody(req, schemaProcesso)
  if (!parsed.ok) return parsed.response
  const { numero, apelido } = parsed.data

  const numeroLimpo = numero.replace(/\D/g, '')
  if (!validarNumeroCNJ(numeroLimpo)) {
    return jsonError('Número de processo (CNJ) inválido. Confira os 20 dígitos.', 400)
  }
  const alias = aliasDataJud(numeroLimpo)
  if (!alias) {
    return jsonError('Tribunal deste processo ainda não é suportado pela consulta automática (DataJud).', 400)
  }

  // Garante que o cliente é do tenant do usuário
  const { data: cliente } = await supabase
    .from('clientes')
    .select('id')
    .eq('id', clienteId)
    .eq('tenant_id', usuario.tenant_id)
    .is('deleted_at', null)
    .single()
  if (!cliente) return jsonError('Cliente não encontrado.', 404)

  const { data: processo, error } = await supabase
    .from('processos')
    .insert({
      tenant_id: usuario.tenant_id,
      cliente_id: clienteId,
      numero_cnj: numeroLimpo,
      tribunal_alias: alias,
      apelido: apelido?.trim() || null,
      created_by: usuario.id,
    })
    .select()
    .single()

  if (error) {
    // 23505 = violação do índice único (tenant_id, numero_cnj)
    if ((error as { code?: string }).code === '23505') {
      return jsonError('Este processo já está cadastrado para este escritório.', 409)
    }
    return jsonError(error.message, 500)
  }

  await logAudit({
    tenantId: usuario.tenant_id,
    userId: usuario.id,
    action: 'processo.vincular',
    resourceType: 'processo',
    resourceId: processo.id,
    metadata: { numero_cnj: numeroLimpo, cliente_id: clienteId, tribunal: alias },
  })

  // Sync imediato (best-effort): snapshot histórico completo. Se o DataJud falhar,
  // o processo fica cadastrado e o cron sincroniza depois.
  let sincronizado = false
  let novosMovimentos = 0
  let naoEncontrado = false
  try {
    const admin = adminClient()
    const r = await sincronizarProcessoPorId(admin, processo.id, { notificar: false })
    if (r === 'nao_encontrado') {
      // Processo novo ainda não indexado no DataJud: marca a fila durável (059) p/ o
      // cron retentar diariamente (o insert nasce com sync_pendente=false por default).
      naoEncontrado = true
      await admin.from('processos').update({ sync_pendente: true }).eq('id', processo.id)
    } else if (r) {
      sincronizado = true
      novosMovimentos = r.novos
    }
  } catch {
    // ignora — cron retenta
  }

  // Religa publicações já capturadas deste número (entraram antes do cadastro) ao
  // processo/cliente recém-criados — senão ficariam órfãs na caixa de Publicações.
  const publicacoesReligadas = await religarPublicacoes(adminClient(), usuario.tenant_id, numeroLimpo, processo.id)

  // Relê para devolver a capa já preenchida pelo sync
  const { data: atual } = await supabase.from('processos').select('*').eq('id', processo.id).single()

  return NextResponse.json(
    { processo: atual ?? processo, sincronizado, novosMovimentos, naoEncontrado, publicacoesReligadas },
    { status: 201 },
  )
}
