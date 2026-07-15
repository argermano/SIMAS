import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getAuthContext, requireRole } from '@/lib/auth'
import { jsonError, validateBody } from '@/lib/api'
import { logAudit } from '@/lib/audit'
import { logger } from '@/lib/logger'
import { apenasDigitos } from '@/lib/conversas/telefone'
import { enviarAvisoWhatsApp } from '@/lib/processos/notificar'
import { carregarBytesAnexo } from '@/lib/conversas/anexo-documento'
import { relaySendAttachment } from '@/lib/conversas/relay'
import { resolverConversaPorTelefone } from '@/lib/conversas/resolver-conversa'

// POST /api/atendimentos/[id]/whatsapp — envia uma mensagem ao cliente pelo
// canal de WhatsApp do escritório SEM sair da tela do atendimento (pedido do
// dono: faltou documento/pedido extra → o atendente dispara dali mesmo).
// Ato HUMANO explícito (equipe toda), no padrão do comunicar do financeiro.
// A mensagem enviada vira um REGISTRO no diário do atendimento.
//
// Dois caminhos, por decisão de arquitetura (NÃO regredir):
//  • TEXTO PURO → canal do bot (enviarAvisoWhatsApp): funciona SEM conversa
//    aberta no Chatwoot; é o comportamento histórico desta rota.
//  • COM ANEXOS → tudo (texto + arquivos) vai pelo RELAY/Chatwoot para manter
//    ordem e atribuição: o texto vira a LEGENDA do primeiro anexo. Isso exige
//    conversa ABERTA (id numérico) e o agente com token pessoal conectado (428).

// Mensagem única (rota + testes) para o cliente sem conversa aberta no Chatwoot.
const MSG_SEM_CONVERSA =
  'O cliente ainda não tem conversa aberta no WhatsApp do escritório — envie só texto ou peça que ele mande um oi'

// Cada anexo é exatamente um: documento do bucket XOR peça (exportada em .docx).
const anexoSchema = z
  .object({
    documentoId: z.string().uuid().optional(),
    pecaId: z.string().uuid().optional(),
  })
  .refine((a) => !!a.documentoId !== !!a.pecaId, {
    message: 'Cada anexo deve ter exatamente um: documentoId OU pecaId',
  })

const schema = z
  .object({
    texto: z.string().trim().min(5).max(2000).optional(),
    anexos: z.array(anexoSchema).min(1).max(5).optional(),
  })
  .refine((d) => !!d.texto || (d.anexos?.length ?? 0) > 0, {
    message: 'Informe um texto ou ao menos um anexo',
  })

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const auth = await getAuthContext()
  if (!auth.ok) return auth.response
  const gate = requireRole(auth.usuario, ['admin', 'advogado', 'colaborador'])
  if (gate) return gate
  const { supabase, usuario } = auth

  const parsed = await validateBody(req, schema)
  if (!parsed.ok) return parsed.response
  const { texto, anexos } = parsed.data

  // Atendimento do tenant + telefone do cliente (RLS já limita ao tenant;
  // o filtro explícito é defesa em profundidade, padrão das rotas irmãs).
  const { data: atendimento } = await supabase
    .from('atendimentos')
    .select('id, cliente_id, clientes(id, nome, telefone)')
    .eq('id', id)
    .eq('tenant_id', usuario.tenant_id)
    .is('deleted_at', null)
    .single()
  if (!atendimento) return jsonError('Atendimento não encontrado', 404)

  const cliente = atendimento.clientes as unknown as { id: string; nome: string | null; telefone: string | null } | null
  const telefone = cliente?.telefone ?? null
  if (!telefone || apenasDigitos(telefone).length < 10) {
    return jsonError('Cliente sem telefone cadastrado — informe o WhatsApp no cartão de contato', 400)
  }

  const temAnexos = (anexos?.length ?? 0) > 0

  // ── Caminho SEM anexos: fluxo histórico intacto (canal do bot) ─────────────
  if (!temAnexos) {
    const r = await enviarAvisoWhatsApp(telefone, texto!)
    if (!r.ok) return jsonError('Falha ao enviar pelo WhatsApp — tente novamente', 502)

    await registrarNoDiario(supabase, { id, tenantId: usuario.tenant_id, userId: usuario.id, texto: texto!, anexos: [] })
    await logAudit({
      tenantId: usuario.tenant_id,
      userId: usuario.id,
      action: 'atendimento.whatsapp_enviado',
      resourceType: 'atendimento',
      resourceId: id,
      metadata: { clienteId: cliente?.id, anexos: 0 },
    })
    return NextResponse.json({ ok: true })
  }

  // ── Caminho COM anexos: tudo pelo relay (texto = legenda do 1º anexo) ──────
  const email = auth.user.email
  if (!email) return jsonError('E-mail do usuário ausente na sessão', 400)

  // LGPD/segurança: todo anexo tem de ser DESTE cliente. Sem isso, um id de
  // documento/peça de OUTRO cliente do mesmo tenant vazaria para o WhatsApp deste
  // (o helper só valida tenant). A UI já filtra por cliente; aqui é a checagem real.
  const clienteId = atendimento.cliente_id as string
  const docIds = [...new Set(anexos!.filter((a) => a.documentoId).map((a) => a.documentoId!))]
  const pecaIds = [...new Set(anexos!.filter((a) => a.pecaId).map((a) => a.pecaId!))]
  if (docIds.length > 0) {
    const { data: docsOk } = await supabase
      .from('documentos')
      .select('id')
      .eq('tenant_id', usuario.tenant_id)
      .eq('cliente_id', clienteId)
      .in('id', docIds)
    if ((docsOk?.length ?? 0) !== docIds.length) {
      return jsonError('Documento não pertence a este cliente', 403)
    }
  }
  if (pecaIds.length > 0) {
    // Peça não tem cliente_id direto: o vínculo é pecas → atendimentos.cliente_id.
    const { data: pecasOk } = await supabase
      .from('pecas')
      .select('id, atendimentos!inner(cliente_id)')
      .eq('tenant_id', usuario.tenant_id)
      .eq('atendimentos.cliente_id', clienteId)
      .in('id', pecaIds)
    if ((pecasOk?.length ?? 0) !== pecaIds.length) {
      return jsonError('Peça não pertence a este cliente', 403)
    }
  }

  // Anexos exigem conversa ABERTA no Chatwoot (o relay posta nela).
  const conversaId = await resolverConversaPorTelefone(email, telefone)
  if (conversaId == null) {
    return NextResponse.json({ error: MSG_SEM_CONVERSA, code: 'SEM_CONVERSA' }, { status: 409 })
  }

  const enviados: string[] = []
  for (let i = 0; i < anexos!.length; i++) {
    const a = anexos![i]
    const anexo = await carregarBytesAnexo({
      supabase,
      tenantId: usuario.tenant_id,
      documentoId: a.documentoId,
      pecaId: a.pecaId,
    })
    if (!anexo.ok) {
      // Nada saiu ainda → erro "limpo" com o status do helper; algo já saiu →
      // 502 de sucesso parcial (o cliente já recebeu parte — não fingir tudo ok).
      if (enviados.length === 0) return jsonError(anexo.erro, anexo.status)
      return jsonError(`Enviei ${enviados.length} de ${anexos!.length}. O anexo seguinte falhou: ${anexo.erro}`, 502)
    }

    const { status, data } = await relaySendAttachment({
      email,
      conversaId: String(conversaId),
      bytes: anexo.bytes,
      filename: anexo.filename,
      contentType: anexo.contentType,
      // Só o PRIMEIRO anexo leva o texto como legenda (mantém a ordem/atribuição).
      caption: i === 0 ? texto ?? '' : '',
    })

    if (status < 200 || status >= 300) {
      if (enviados.length === 0) {
        // Repassa o status/erro do relay (428 AGENTE_NAO_CONECTADO, 413, etc.),
        // preservando `code` para o cliente mapear a mensagem.
        const corpo = data && typeof data === 'object' ? data : {}
        return NextResponse.json({ error: 'Falha ao enviar o anexo pelo WhatsApp', ...corpo }, { status })
      }
      return NextResponse.json(
        { error: `Enviei ${enviados.length} de ${anexos!.length}; "${anexo.filename}" falhou.` },
        { status: 502 },
      )
    }
    enviados.push(anexo.filename)
  }

  await registrarNoDiario(supabase, {
    id,
    tenantId: usuario.tenant_id,
    userId: usuario.id,
    texto: texto ?? '',
    anexos: enviados,
  })
  await logAudit({
    tenantId: usuario.tenant_id,
    userId: usuario.id,
    action: 'atendimento.whatsapp_enviado',
    resourceType: 'atendimento',
    resourceId: id,
    metadata: { clienteId: cliente?.id, anexos: enviados.length },
  })
  return NextResponse.json({ ok: true, anexos: enviados.length })
}

// Registro no diário (best-effort: o envio já aconteceu; falha aqui só loga).
// Formato: cabeçalho + texto (se houver) + uma linha 📎 por anexo enviado.
async function registrarNoDiario(
  supabase: Extract<Awaited<ReturnType<typeof getAuthContext>>, { ok: true }>['supabase'],
  args: { id: string; tenantId: string; userId: string; texto: string; anexos: string[] },
) {
  const linhas = ['📱 WhatsApp enviado ao cliente:']
  if (args.texto) linhas.push(args.texto)
  for (const nome of args.anexos) linhas.push(`📎 ${nome}`)

  const { error } = await supabase.from('atendimento_registros').insert({
    tenant_id: args.tenantId,
    atendimento_id: args.id,
    user_id: args.userId,
    texto: linhas.join('\n'),
  })
  if (error) {
    logger.error('atendimento.whatsapp.registro_falhou', { atendimentoId: args.id, tenantId: args.tenantId })
  }
}
