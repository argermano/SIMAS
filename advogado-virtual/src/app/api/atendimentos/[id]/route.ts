import { NextResponse } from 'next/server'
import { z } from 'zod'
import { getAuthContext, requireRole } from '@/lib/auth'
import { jsonError } from '@/lib/api'
import { logAudit } from '@/lib/audit'
import { encryptField, decryptTranscricaoFields } from '@/lib/encryption'
import { etiquetasField, schemaVinculoAtendimento, vinculoAtendimentoParaColunas } from '@/lib/atendimentos'
import { vinculoValido } from '@/lib/tarefas/validar-vinculo'
import type { createClient } from '@/lib/supabase/server'

type SupabaseServer = Awaited<ReturnType<typeof createClient>>

// GET /api/atendimentos/[id] — retorna atendimento com documentos
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params

  const auth = await getAuthContext()
  if (!auth.ok) return auth.response
  const { supabase, usuario } = auth

  const { data: atendimento, error } = await supabase
    .from('atendimentos')
    .select('*, clientes(id, nome), documentos(*), analises(id, plano_a, resumo_fatos, status, created_at), pecas(id, tipo, area, versao, status, created_at)')
    .eq('id', id)
    .eq('tenant_id', usuario.tenant_id)
    .is('deleted_at', null)
    .single()

  if (error || !atendimento) {
    return jsonError('Atendimento não encontrado', 404)
  }

  // O embed `documentos(*)` acima traz só os docs NASCIDOS aqui (FK
  // documentos.atendimento_id). Com os vínculos N:N (063), docs do cadastro
  // reaproveitados no caso entram como ATALHO (linha em documento_vinculos, sem
  // atendimento_id) e não vêm no embed — o Estudo precisa deles ao recarregar
  // (contexto da análise). Busca e mescla (dedupe por id: um doc pode nascer aqui
  // E ter linha de vínculo). Mantém file_url/texto_extraido → o cliente separa
  // "do cadastro" vs "do caso" e usa o texto como contexto.
  const { data: vincRows } = await supabase
    .from('documento_vinculos')
    .select('documentos(*)')
    .eq('atendimento_id', id)
    .eq('tenant_id', usuario.tenant_id)
  type DocRow = { id: string } & Record<string, unknown>
  const embutidos = ((atendimento.documentos ?? []) as DocRow[])
  const idsEmbutidos = new Set(embutidos.map((d) => d.id))
  const atalhos = (vincRows ?? [])
    .map((v) => (Array.isArray(v.documentos) ? v.documentos[0] : v.documentos) as DocRow | null)
    .filter((d): d is DocRow => !!d && !idsEmbutidos.has(d.id))
  if (atalhos.length > 0) {
    ;(atendimento as unknown as { documentos: DocRow[] }).documentos = [...embutidos, ...atalhos]
  }

  // Fetch contratos linked to this atendimento
  const { data: contratos } = await supabase
    .from('contratos_honorarios')
    .select('id, titulo, status, area, created_at')
    .eq('atendimento_id', id)
    .order('created_at', { ascending: false })

  // Decifra a transcrição antes de devolver (o cliente exibe o relato).
  return NextResponse.json({ atendimento: decryptTranscricaoFields(atendimento), contratos: contratos ?? [] })
}

const schemaUpdate = z.object({
  transcricao_editada:          z.string().optional(),
  pedidos_especificos:          z.string().optional(),
  // 'finalizado' NÃO entra aqui: o encerramento é fonte única (status + encerrado_em)
  // e só acontece pela ação 'encerrar' — evita status='finalizado' com encerrado_em=null.
  status:                       z.enum(['caso_novo', 'peca_gerada']).optional(),
  modo_input:                   z.enum(['audio', 'texto']).optional(),
  tipo_servico:                 z.enum(['administrativo', 'judicial']).nullable().optional(),
  tipo_processo:                z.string().nullable().optional(),
  consentimento_gravacao:       z.boolean().optional(),
  consentimento_confirmado_em:  z.string().optional(), // ISO 8601
  // Primeiro atendimento (056): organização leve.
  titulo:                       z.string().trim().max(200).nullable().optional(),
  etiquetas:                    etiquetasField.optional(),
  // Vínculo com outro caso/atendimento ou processo (057): objeto altera, null limpa.
  vinculo:                      schemaVinculoAtendimento.nullable().optional(),
  // Transições de ciclo de vida são explícitas (não via `status`/`estagio` crus)
  // para centralizar as validações (não encerrar já-encerrado; estágio one-way).
  acao:                         z.enum(['encerrar', 'reabrir', 'transformar_caso']).optional(),
}).partial()

// PATCH /api/atendimentos/[id] — atualiza atendimento
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params

  const auth = await getAuthContext()
  if (!auth.ok) return auth.response
  const { supabase, usuario } = auth

  const body = await req.json()
  const resultado = schemaUpdate.safeParse(body)

  if (!resultado.success) {
    return jsonError('Dados inválidos', 400, resultado.error.flatten())
  }

  const dados = resultado.data

  // ── Transições de ciclo de vida (encerrar/reabrir/transformar_caso) ─────────
  // Processadas de forma EXCLUSIVA: quando há `acao`, ignoramos os demais campos
  // e aplicamos só a transição (evita estados inconsistentes num mesmo PATCH).
  if (dados.acao) {
    // Transições de ciclo de vida são consequentes (transformar_caso é one-way):
    // exigem o mesmo papel do DELETE (admin/advogado), não só autenticação.
    const semPermissao = requireRole(usuario, ['admin', 'advogado'])
    if (semPermissao) return semPermissao
    return await aplicarAcao(supabase, usuario, id, dados.acao)
  }

  // ── Atualização de campos comuns ────────────────────────────────────────────
  const dadosUpdate: Record<string, unknown> = {}
  if (dados.transcricao_editada !== undefined)
    dadosUpdate.transcricao_editada = encryptField(dados.transcricao_editada) // cifra em repouso (dado sensível)
  if (dados.pedidos_especificos !== undefined) dadosUpdate.pedidos_especificos = dados.pedidos_especificos
  if (dados.status !== undefined)              dadosUpdate.status              = dados.status
  if (dados.modo_input !== undefined)          dadosUpdate.modo_input          = dados.modo_input
  if (dados.tipo_servico !== undefined)        dadosUpdate.tipo_servico        = dados.tipo_servico
  if (dados.tipo_processo !== undefined)       dadosUpdate.tipo_processo       = dados.tipo_processo
  if (dados.consentimento_gravacao !== undefined) dadosUpdate.consentimento_gravacao = dados.consentimento_gravacao
  if (dados.consentimento_confirmado_em !== undefined) dadosUpdate.consentimento_confirmado_em = dados.consentimento_confirmado_em
  if (dados.titulo !== undefined)              dadosUpdate.titulo              = dados.titulo || null
  if (dados.etiquetas !== undefined)           dadosUpdate.etiquetas           = dados.etiquetas

  // Vínculo (057): objeto grava na coluna do tipo; null zera ambas.
  if (dados.vinculo !== undefined) {
    if (dados.vinculo) {
      // Não pode vincular-se a si mesmo (o CHECK do banco também barra).
      if (dados.vinculo.tipo === 'atendimento' && dados.vinculo.id === id) {
        return jsonError('Um atendimento não pode ser vinculado a si mesmo', 400)
      }
      if (!(await vinculoValido(supabase, dados.vinculo, usuario.tenant_id))) {
        return jsonError('Vínculo inválido', 400)
      }
    }
    Object.assign(dadosUpdate, vinculoAtendimentoParaColunas(dados.vinculo ?? null))
  }

  if (Object.keys(dadosUpdate).length === 0) {
    return jsonError('Nada para atualizar', 400)
  }

  const { data: atendimento, error } = await supabase
    .from('atendimentos')
    .update(dadosUpdate)
    .eq('id', id)
    .eq('tenant_id', usuario.tenant_id)
    .is('deleted_at', null)
    .select('id, status')
    .single()

  if (error || !atendimento) {
    return jsonError('Atendimento não encontrado', 404)
  }

  return NextResponse.json({ atendimento })
}

type Acao = 'encerrar' | 'reabrir' | 'transformar_caso'

// Executa uma transição de ciclo de vida com as validações do contrato.
async function aplicarAcao(
  supabase: SupabaseServer,
  usuario: { id: string; tenant_id: string },
  id: string,
  acao: Acao,
): Promise<NextResponse> {
  const { data: atual } = await supabase
    .from('atendimentos')
    .select('id, status, estagio, encerrado_em')
    .eq('id', id)
    .eq('tenant_id', usuario.tenant_id)
    .is('deleted_at', null)
    .single()

  if (!atual) return jsonError('Atendimento não encontrado', 404)

  let update: Record<string, unknown>
  let action: string

  if (acao === 'encerrar') {
    if (atual.encerrado_em) return jsonError('Atendimento já encerrado', 409)
    update = { status: 'finalizado', encerrado_em: new Date().toISOString() }
    action = 'atendimento.encerrado'
  } else if (acao === 'reabrir') {
    if (!atual.encerrado_em) return jsonError('Atendimento não está encerrado', 409)
    // Volta ao status coerente: 'peca_gerada' se já existe peça, senão 'caso_novo'.
    const { count } = await supabase
      .from('pecas')
      .select('id', { count: 'exact', head: true })
      .eq('atendimento_id', id)
    update = { status: (count ?? 0) > 0 ? 'peca_gerada' : 'caso_novo', encerrado_em: null }
    action = 'atendimento.reaberto'
  } else {
    // transformar_caso — one-way: só de 'atendimento' para 'caso'.
    if (atual.estagio !== 'atendimento') return jsonError('Só é possível transformar um atendimento em caso', 409)
    update = { estagio: 'caso' }
    action = 'atendimento.transformado_caso'
  }

  const { data: atendimento, error } = await supabase
    .from('atendimentos')
    .update(update)
    .eq('id', id)
    .eq('tenant_id', usuario.tenant_id)
    .select('id, status, estagio, encerrado_em')
    .single()

  if (error || !atendimento) return jsonError('Atendimento não encontrado', 404)

  await logAudit({
    tenantId: usuario.tenant_id,
    userId: usuario.id,
    action,
    resourceType: 'atendimento',
    resourceId: id,
  })

  return NextResponse.json({ atendimento })
}

// DELETE /api/atendimentos/[id] — soft-delete do caso (preserva peças, análises,
// documentos e áudio; some das listagens e pode ser revertido/auditado).
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params

  const auth = await getAuthContext()
  if (!auth.ok) return auth.response
  const { supabase, usuario } = auth

  // Só admin/advogado pode excluir um caso (antes: qualquer papel, com cascata
  // hard-delete irreversível de peças/análises/documentos + remoção do Storage).
  const semPermissao = requireRole(usuario, ['admin', 'advogado'])
  if (semPermissao) return semPermissao

  // Verificar que o atendimento pertence ao tenant e ainda está ativo
  const { data: at } = await supabase
    .from('atendimentos')
    .select('id')
    .eq('id', id)
    .eq('tenant_id', usuario.tenant_id)
    .is('deleted_at', null)
    .single()

  if (!at) {
    return jsonError('Atendimento não encontrado', 404)
  }

  const { error: delError } = await supabase
    .from('atendimentos')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', id)
    .eq('tenant_id', usuario.tenant_id)

  if (delError) {
    return jsonError('Erro ao excluir atendimento', 500)
  }

  await logAudit({
    tenantId: usuario.tenant_id,
    userId: usuario.id,
    action: 'atendimento.delete',
    resourceType: 'atendimento',
    resourceId: id,
    metadata: { soft: true },
  })

  return NextResponse.json({ ok: true })
}
