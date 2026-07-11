import { NextRequest, NextResponse } from 'next/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { z } from 'zod'
import { getAuthContext, requireRole } from '@/lib/auth'
import { jsonError, validateBody } from '@/lib/api'
import { logAudit } from '@/lib/audit'
import { montarTextoAvisoParcela } from '@/lib/financeiro/aviso'
import { gerarPixCopiaECola } from '@/lib/financeiro/pix'
import { enviarAvisoWhatsApp } from '@/lib/processos/notificar'
import { hojeSaoPauloISO } from '@/lib/processos/util'

// ─────────────────────────────────────────────────────────────
// Comunicar cobrança por WhatsApp SOB DEMANDA (pedido do dono, 2026-07-11):
// GET  = prévia (texto gerado + telefone + contexto) para o modal.
// POST = envia o texto (humano revisou/editou) pelo canal do bot (/notify).
// O envio manual é ato HUMANO: opt-out do aviso automático NÃO bloqueia (o
// modal avisa); parcela vencida PODE ser comunicada manualmente ("venceu em").
// Decisão do dono: o envio manual NÃO consome os avisos automáticos — a
// parcela (mesmo avulsa) continua no cron seguindo o desenho D-3/D-0.
// ─────────────────────────────────────────────────────────────

interface Contexto {
  parcela: { id: string; descricao: string; valor_centavos: number; vencimento: string; status: string; cliente_id: string }
  cliente: { nome: string | null; telefone: string | null; aviso_cobranca: boolean }
  texto: string
}

async function carregarContexto(tenantId: string, parcelaId: string): Promise<Contexto | { erro: string; status: number }> {
  const admin = createAdminClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
  const { data: p } = await admin
    .from('parcelas')
    .select('id, descricao, valor_centavos, vencimento, status, cliente_id')
    .eq('id', parcelaId)
    .eq('tenant_id', tenantId)
    .single()
  if (!p) return { erro: 'Parcela não encontrada', status: 404 }
  if (p.status !== 'aberta') return { erro: 'Só é possível comunicar parcelas em aberto', status: 409 }
  const { data: c } = await admin
    .from('clientes')
    .select('nome, telefone, aviso_cobranca')
    .eq('id', p.cliente_id)
    .eq('tenant_id', tenantId)
    .single()
  if (!c) return { erro: 'Cliente não encontrado', status: 404 }
  const { data: t } = await admin.from('tenants').select('nome, config').eq('id', tenantId).single()
  const fin = (t?.config as { financeiro?: { pix_chave?: string; pix_nome?: string; pix_cidade?: string } } | null)?.financeiro
  const hoje = hojeSaoPauloISO()
  const pix = fin?.pix_chave
    ? gerarPixCopiaECola({
        chave: fin.pix_chave,
        nome: fin.pix_nome || t?.nome || '',
        cidade: fin.pix_cidade || 'BRASILIA',
        valorCentavos: p.valor_centavos,
      })
    : null
  const texto = montarTextoAvisoParcela({
    nomeCliente: c.nome,
    descricao: p.descricao,
    valorCentavos: p.valor_centavos,
    vencimentoISO: p.vencimento,
    pixCopiaECola: pix,
    escritorioNome: t?.nome ?? null,
    ehHoje: p.vencimento === hoje,
    ehVencida: p.vencimento < hoje,
  })
  return { parcela: p, cliente: c, texto }
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const auth = await getAuthContext()
  if (!auth.ok) return auth.response
  const gate = requireRole(auth.usuario, ['admin', 'advogado', 'colaborador'])
  if (gate) return gate

  const ctx = await carregarContexto(auth.usuario.tenant_id, id)
  if ('erro' in ctx) return jsonError(ctx.erro, ctx.status)
  return NextResponse.json({
    texto: ctx.texto,
    telefone: ctx.cliente.telefone,
    clienteNome: ctx.cliente.nome,
    avisoOptOut: !ctx.cliente.aviso_cobranca,
    vencida: ctx.parcela.vencimento < hojeSaoPauloISO(),
  })
}

const schemaEnvio = z.object({ texto: z.string().min(10).max(2000) })

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const auth = await getAuthContext()
  if (!auth.ok) return auth.response
  const gate = requireRole(auth.usuario, ['admin', 'advogado', 'colaborador'])
  if (gate) return gate
  const parsed = await validateBody(req, schemaEnvio)
  if (!parsed.ok) return parsed.response

  const ctx = await carregarContexto(auth.usuario.tenant_id, id)
  if ('erro' in ctx) return jsonError(ctx.erro, ctx.status)
  if (!ctx.cliente.telefone) return jsonError('Cliente sem telefone cadastrado', 400)

  const r = await enviarAvisoWhatsApp(ctx.cliente.telefone, parsed.data.texto)
  if (!r.ok) return jsonError('Falha ao enviar pelo WhatsApp — tente novamente', 502)

  await logAudit({
    tenantId: auth.usuario.tenant_id,
    userId: auth.usuario.id,
    action: 'financeiro.cobranca_comunicada',
    resourceType: 'parcela',
    resourceId: id,
    metadata: { manual: true },
  })
  return NextResponse.json({ ok: true })
}
