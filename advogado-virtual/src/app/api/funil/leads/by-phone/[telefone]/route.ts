import { NextResponse } from 'next/server'
import { jsonError } from '@/lib/api'
import { autorizadoIntegracao } from '@/lib/funil/auth-integracao'
import { adminFunil, tenantFunil } from '@/lib/funil/leads'
import { mesmoTelefone } from '@/lib/funil/telefone'

// PATCH /api/funil/leads/by-phone/:telefone — ai-attendant: atualiza área/nome/
// e-mail do lead ativo quando o modelo classifica o assunto (spec §6). Sem mover
// etapa. 200 { ok:false } se não houver lead ativo (não é erro).
export async function PATCH(req: Request, { params }: { params: Promise<{ telefone: string }> }) {
  if (!autorizadoIntegracao(req)) return new NextResponse('Unauthorized', { status: 401 })

  const tenantId = tenantFunil()
  if (!tenantId) return jsonError('FUNIL_TENANT_ID não configurado', 500)

  const { telefone } = await params
  const body = (await req.json().catch(() => ({}))) as {
    nomeInformado?: string; area?: string; email?: string; ultimoContatoEm?: string
  }
  const admin = adminFunil()

  const { data: leads } = await admin
    .from('funil_leads')
    .select('id, telefone')
    .eq('tenant_id', tenantId)
    .not('etapa', 'in', '(contrato_fechado,perdido)')
  const lead = (leads ?? []).find((l) => mesmoTelefone(l.telefone as string, telefone))
  if (!lead) return NextResponse.json({ ok: false })

  const agora = new Date().toISOString()
  const patch: Record<string, unknown> = { ultimo_contato_em: body.ultimoContatoEm || agora, updated_at: agora }
  if (body.nomeInformado) patch.nome_informado = body.nomeInformado
  if (body.area) patch.area = body.area
  if (body.email) patch.email = body.email

  await admin.from('funil_leads').update(patch).eq('id', lead.id)
  return NextResponse.json({ ok: true, leadId: lead.id })
}
