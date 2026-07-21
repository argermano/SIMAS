import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getAuthContext, requireRole } from '@/lib/auth'
import { jsonError, validateBody } from '@/lib/api'
import { logAudit } from '@/lib/audit'
import { logger } from '@/lib/logger'
import { telefoneEnvioValido, validarAnexosDoCliente, despacharWhatsAppCliente } from '@/lib/conversas/whatsapp-cliente'
import { instanciaDaUnidade } from '@/lib/conversas/instancia'

// POST /api/atendimentos/[id]/whatsapp — envia uma mensagem ao cliente pelo
// canal de WhatsApp do escritório SEM sair da tela do atendimento (pedido do
// dono: faltou documento/pedido extra → o atendente dispara dali mesmo).
// Ato HUMANO explícito (equipe toda), no padrão do comunicar do financeiro.
// A mensagem enviada vira um REGISTRO no diário do atendimento.
//
// TUDO vai pelo canal do bot (Evolution): texto via enviarAvisoWhatsApp e
// anexos via enviarMediaWhatsApp (sendMedia) — funciona para QUALQUER número,
// inclusive cliente novo SEM conversa aberta no Chatwoot (decisão do dono após
// testar com número novo). O texto vira a legenda do primeiro anexo. A mensagem
// aparece no Chatwoot pela sincronização do Evolution; a autoria fica no diário.

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
    // Número de saída (envio HUMANO): instância explícita, ou null p/ forçar o
    // automático (DDD). Ausente → default pela unidade do usuário logado.
    instancia: z.enum(['whatsapp-sc', 'whatsapp-df']).nullable().optional(),
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
  const { texto, anexos, instancia: instanciaCorpo } = parsed.data
  // Não veio no corpo → default pela unidade; veio explícito (instância ou null=DDD) → respeita.
  const instancia = instanciaCorpo === undefined ? instanciaDaUnidade(usuario.unidade) : instanciaCorpo

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
  if (!telefoneEnvioValido(telefone)) {
    return jsonError('Cliente sem telefone cadastrado — informe o WhatsApp no cartão de contato', 400)
  }

  const temAnexos = (anexos?.length ?? 0) > 0

  // Posse dos anexos (LGPD): todo anexo tem de ser DESTE cliente — checagem real
  // no servidor (a UI já filtra por cliente). Núcleo compartilhado com a rota
  // POR CLIENTE — comportamento idêntico ao que esta rota já fazia.
  if (temAnexos) {
    const posse = await validarAnexosDoCliente({
      supabase,
      tenantId: usuario.tenant_id,
      clienteId: atendimento.cliente_id as string,
      anexos: anexos!,
    })
    if (!posse.ok) return jsonError(posse.erro, posse.status)
  }

  // Envio pelo canal do bot (texto e/ou anexos). Funciona para QUALQUER número —
  // inclusive cliente novo SEM conversa aberta no Chatwoot (caso real do dono:
  // mandar a procuração no primeiro contato). A autoria fica no diário do caso.
  const envio = await despacharWhatsAppCliente({
    supabase,
    tenantId: usuario.tenant_id,
    telefone: telefone!,
    texto,
    anexos,
    instancia,
  })
  if (!envio.ok) return jsonError(envio.erro, envio.status)

  await registrarNoDiario(supabase, {
    id,
    tenantId: usuario.tenant_id,
    userId: usuario.id,
    texto: texto ?? '',
    anexos: envio.enviados,
  })
  await logAudit({
    tenantId: usuario.tenant_id,
    userId: usuario.id,
    action: 'atendimento.whatsapp_enviado',
    resourceType: 'atendimento',
    resourceId: id,
    metadata: { clienteId: cliente?.id, anexos: envio.enviados.length },
  })
  return NextResponse.json(temAnexos ? { ok: true, anexos: envio.enviados.length } : { ok: true })
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
