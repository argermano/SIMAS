import { NextResponse } from 'next/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { getAuthContext } from '@/lib/auth'
import { jsonError } from '@/lib/api'
import { logAudit } from '@/lib/audit'
import { enfileirarDriveSync } from '@/lib/drive/fila'

// Client service-role só para o gatilho do espelho (drive_sync_fila é service-only,
// RLS sem policy — o client de sessão seria barrado). Ver 066 e src/lib/drive.
const driveAdmin = () =>
  createAdminClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

// PATCH /api/documentos/[docId]/vinculo — gere os vínculos N:N do doc (063). Um
// doc pode estar em VÁRIOS casos/processos ao mesmo tempo (atalhos de "pasta");
// cada vínculo é uma linha em documento_vinculos.
//
// Shapes aceitos:
//   • NOVO  { adicionar: { atendimento_id } | { processo_id } } → cria a linha
//           (idempotente: já existe = 200 com jaExistia:true).
//   • NOVO  { remover:   { atendimento_id } | { processo_id } } → apaga a linha.
//   • ANTIGO { atendimento_id } | { processo_id }  → mapeia para adicionar.
//   • ANTIGO { desvincular: true }                 → remove TODOS os vínculos.
// (o shape antigo segue vivo porque a UI em produção só troca na fase UI.)
//
// Segurança: o alvo (caso/processo) precisa ser do MESMO cliente e tenant do doc —
// senão 403. O doc precisa ter cliente_id (dono no dossiê).
// LGPD: auditoria só com ids/contagens, nunca nomes de arquivo.

type AlvoNovo = { atendimento_id?: string | null; processo_id?: string | null }
type Body = {
  adicionar?: AlvoNovo
  remover?: AlvoNovo
  // shape antigo (compat)
  atendimento_id?: string | null
  processo_id?: string | null
  desvincular?: boolean
}

// Normaliza um alvo ({atendimento_id} XOR {processo_id}) → tipo/id, ou null se inválido.
function lerAlvo(a: AlvoNovo | undefined): { tipo: 'atendimento' | 'processo'; id: string } | null {
  if (!a) return null
  if (typeof a.atendimento_id === 'string' && a.atendimento_id) return { tipo: 'atendimento', id: a.atendimento_id }
  if (typeof a.processo_id === 'string' && a.processo_id) return { tipo: 'processo', id: a.processo_id }
  return null
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ docId: string }> },
) {
  const { docId } = await params
  const auth = await getAuthContext()
  if (!auth.ok) return auth.response
  const { supabase, usuario } = auth
  const tenantId = usuario.tenant_id

  const body = (await req.json().catch(() => null)) as Body | null
  if (!body) return jsonError('Corpo da requisição inválido', 400)

  const { data: doc } = await supabase
    .from('documentos')
    .select('id, cliente_id')
    .eq('id', docId)
    .eq('tenant_id', tenantId)
    .single()
  if (!doc) return jsonError('Documento não encontrado', 404)
  // O vínculo se apoia na posse do doc pelo cliente (dono no dossiê).
  if (!doc.cliente_id) return jsonError('Documento sem cliente — não é possível vincular.', 400)

  // Confere que o alvo existe e é do MESMO cliente do doc (senão 403/404).
  async function validarAlvo(tipo: 'atendimento' | 'processo', id: string): Promise<Response | null> {
    if (tipo === 'atendimento') {
      const { data: alvo } = await supabase
        .from('atendimentos').select('id, cliente_id')
        .eq('id', id).eq('tenant_id', tenantId).is('deleted_at', null).single()
      if (!alvo) return jsonError('Caso não encontrado', 404)
      if (alvo.cliente_id !== doc!.cliente_id) return jsonError('O caso pertence a outro cliente.', 403)
    } else {
      const { data: alvo } = await supabase
        .from('processos').select('id, cliente_id')
        .eq('id', id).eq('tenant_id', tenantId).single()
      if (!alvo) return jsonError('Processo não encontrado', 404)
      if (alvo.cliente_id !== doc!.cliente_id) return jsonError('O processo pertence a outro cliente.', 403)
    }
    return null
  }

  // ── ADICIONAR (novo, ou shape antigo {atendimento_id}/{processo_id}) ────────
  const alvoAdd = lerAlvo(body.adicionar) ?? lerAlvo({ atendimento_id: body.atendimento_id, processo_id: body.processo_id })
  if (alvoAdd) {
    const erro = await validarAlvo(alvoAdd.tipo, alvoAdd.id)
    if (erro) return erro

    const col = alvoAdd.tipo === 'atendimento' ? 'atendimento_id' : 'processo_id'
    // Idempotente: se já existe a linha, não recria (o UNIQUE parcial também barra).
    const { data: existente } = await supabase
      .from('documento_vinculos').select('id')
      .eq('documento_id', docId).eq(col, alvoAdd.id).eq('tenant_id', tenantId).maybeSingle()
    if (existente) {
      return NextResponse.json({ ok: true, jaExistia: true, vinculo: { [col]: alvoAdd.id } })
    }

    const { error } = await supabase
      .from('documento_vinculos')
      .insert({ tenant_id: tenantId, documento_id: docId, [col]: alvoAdd.id })
    // Corrida: outra requisição inseriu antes (viola o UNIQUE parcial) = já existe.
    if (error && error.code === '23505') {
      return NextResponse.json({ ok: true, jaExistia: true, vinculo: { [col]: alvoAdd.id } })
    }
    if (error) return jsonError(error.message, 500)

    await logAudit({
      tenantId, userId: usuario.id,
      action: 'documento.vincular', resourceType: 'documento', resourceId: docId,
      metadata: { cliente_id: doc.cliente_id, [col]: alvoAdd.id },
    })
    // O conjunto de pastas do doc mudou → reespelha o cliente no Drive.
    await enfileirarDriveSync(driveAdmin(), tenantId, doc.cliente_id)
    return NextResponse.json({ ok: true, jaExistia: false, vinculo: { [col]: alvoAdd.id } })
  }

  // ── REMOVER um vínculo específico (novo) ────────────────────────────────────
  const alvoDel = lerAlvo(body.remover)
  if (alvoDel) {
    const col = alvoDel.tipo === 'atendimento' ? 'atendimento_id' : 'processo_id'
    const { error } = await supabase
      .from('documento_vinculos').delete()
      .eq('documento_id', docId).eq(col, alvoDel.id).eq('tenant_id', tenantId)
    if (error) return jsonError(error.message, 500)
    await logAudit({
      tenantId, userId: usuario.id,
      action: 'documento.desvincular', resourceType: 'documento', resourceId: docId,
      metadata: { cliente_id: doc.cliente_id, [col]: alvoDel.id },
    })
    await enfileirarDriveSync(driveAdmin(), tenantId, doc.cliente_id)
    return NextResponse.json({ ok: true })
  }

  // ── DESVINCULAR TODOS (shape antigo {desvincular:true}) ─────────────────────
  if (body.desvincular === true) {
    const { data: removidas, error } = await supabase
      .from('documento_vinculos').delete()
      .eq('documento_id', docId).eq('tenant_id', tenantId)
      .select('id')
    if (error) return jsonError(error.message, 500)
    await logAudit({
      tenantId, userId: usuario.id,
      action: 'documento.desvincular', resourceType: 'documento', resourceId: docId,
      metadata: { cliente_id: doc.cliente_id, removidos: (removidas ?? []).length },
    })
    await enfileirarDriveSync(driveAdmin(), tenantId, doc.cliente_id)
    return NextResponse.json({ ok: true, removidos: (removidas ?? []).length })
  }

  return jsonError('Informe adicionar, remover ou desvincular.', 400)
}
