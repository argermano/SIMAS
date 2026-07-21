import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getAuthContext, requireRole } from '@/lib/auth'
import { jsonError, validateBody } from '@/lib/api'
import { logAudit } from '@/lib/audit'
import {
  telefoneEnvioValido,
  validarAnexosDoCliente,
  despacharWhatsAppCliente,
} from '@/lib/conversas/whatsapp-cliente'
import { instanciaDaUnidade } from '@/lib/conversas/instancia'

// POST /api/clientes/[id]/whatsapp — envia uma mensagem ao cliente pelo canal de
// WhatsApp do escritório a partir de QUALQUER tela em que o cliente esteja
// selecionado (dossiê, Estudo de Caso, …) — SEM um atendimento em contexto.
// Ato HUMANO explícito (equipe toda), no padrão da rota do caso e do financeiro.
//
// Mesma lógica da rota do caso (/api/atendimentos/[id]/whatsapp), reusando o
// núcleo compartilhado: texto e/ou anexos vão TODOS pelo canal do bot (Evolution),
// valida que cada anexo é do MESMO cliente e funciona para QUALQUER número. A
// diferença: NÃO há caso, então NÃO grava diário — registra só a auditoria. O
// telefone-alvo é o do cadastro, mas pode vir editado no corpo (qualquer número).

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
    // Telefone editável no modal (cadastro pré-preenchido); em branco → usa o do
    // cadastro. Envio passa pelo bot, então vale qualquer número.
    telefone: z.string().trim().max(30).optional(),
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
  const { texto, telefone: telefoneCorpo, anexos, instancia: instanciaCorpo } = parsed.data
  // Não veio no corpo → default pela unidade; veio explícito (instância ou null=DDD) → respeita.
  const instancia = instanciaCorpo === undefined ? instanciaDaUnidade(usuario.unidade) : instanciaCorpo

  // Cliente do tenant + telefone do cadastro (RLS limita ao tenant; o filtro
  // explícito é defesa em profundidade, padrão das rotas irmãs).
  const { data: cliente } = await supabase
    .from('clientes')
    .select('id, nome, telefone')
    .eq('id', id)
    .eq('tenant_id', usuario.tenant_id)
    .is('deleted_at', null)
    .single()
  if (!cliente) return jsonError('Cliente não encontrado', 404)

  // Alvo: telefone editado no modal OU o do cadastro. Sem número válido em
  // nenhum → 400 (não dá para enviar).
  const telefoneAlvo = (telefoneCorpo && telefoneCorpo.length > 0 ? telefoneCorpo : cliente.telefone) ?? null
  if (!telefoneEnvioValido(telefoneAlvo)) {
    return jsonError('Informe um telefone válido (DDD + número) para enviar o WhatsApp', 400)
  }

  const temAnexos = (anexos?.length ?? 0) > 0

  // Posse dos anexos (LGPD): todo anexo tem de ser DESTE cliente — checagem real
  // no servidor (a UI já filtra por cliente).
  if (temAnexos) {
    const posse = await validarAnexosDoCliente({
      supabase,
      tenantId: usuario.tenant_id,
      clienteId: id,
      anexos: anexos!,
    })
    if (!posse.ok) return jsonError(posse.erro, posse.status)
  }

  const envio = await despacharWhatsAppCliente({
    supabase,
    tenantId: usuario.tenant_id,
    telefone: telefoneAlvo!,
    texto,
    anexos,
    instancia,
  })
  if (!envio.ok) return jsonError(envio.erro, envio.status)

  // Sem caso → sem diário; só auditoria (padrão LGPD: não loga conteúdo).
  await logAudit({
    tenantId: usuario.tenant_id,
    userId: usuario.id,
    action: 'cliente.whatsapp_enviado',
    resourceType: 'cliente',
    resourceId: id,
    metadata: { anexos: envio.enviados.length },
  })

  return NextResponse.json(temAnexos ? { ok: true, anexos: envio.enviados.length } : { ok: true })
}
