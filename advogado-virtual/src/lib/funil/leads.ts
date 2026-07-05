import { createClient as createAdminClient, type SupabaseClient } from '@supabase/supabase-js'
import { normalizarE164, mesmoTelefone } from './telefone'
import type { EtapaFunil, AtorMovimentacao } from './regras'

/** Cliente service_role para as rotas de integração (sem sessão de usuário). */
export function adminFunil(): SupabaseClient {
  return createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )
}

/** tenant do funil no piloto (1 escritório). Multi-tenant fica como pendência. */
export function tenantFunil(): string | null {
  return process.env.FUNIL_TENANT_ID || null
}

export interface DadosLead {
  telefone: string
  nomeInformado?: string | null
  email?: string | null
  unidade?: string | null
  chatwootConversationId?: number | null
  ator?: AtorMovimentacao
  etapaInicial?: EtapaFunil
  ultimaMensagem?: string | null
  ultimaMensagemAutor?: string | null
  ultimaMensagemEm?: string | null
}

const AUTORES_MSG = new Set(['cliente', 'atendente', 'ia'])

/**
 * Campos do patch para a última interação do WhatsApp (sistema fechado,
 * cliente↔escritório). Trunca em 300 chars e valida o autor. Retorna {} se não
 * houver texto — nunca guarda dossiê do caso, só a última mensagem trocada.
 */
export function patchUltimaMensagem(
  body: { ultimaMensagem?: string | null; ultimaMensagemAutor?: string | null; ultimaMensagemEm?: string | null },
): Record<string, unknown> {
  const texto = body.ultimaMensagem?.trim()
  if (!texto) return {}
  const autor = body.ultimaMensagemAutor && AUTORES_MSG.has(body.ultimaMensagemAutor) ? body.ultimaMensagemAutor : 'cliente'
  return {
    ultima_mensagem: texto.length > 300 ? texto.slice(0, 299) + '…' : texto,
    ultima_mensagem_autor: autor,
    ultima_mensagem_em: body.ultimaMensagemEm || new Date().toISOString(),
  }
}

export interface ResultadoUpsert {
  leadId: string
  novo: boolean
  clienteExistente: boolean
}

/**
 * Entra um lead no funil (spec §2): dedup por telefone (lead ativo atualiza,
 * não duplica) → vincula a cliente existente (badge) ou cria pré-cadastro →
 * cria o lead. Usa o admin client (service_role). NÃO guarda dado sensível.
 */
export async function upsertLeadComPreCadastro(
  admin: SupabaseClient,
  tenantId: string,
  dados: DadosLead,
): Promise<ResultadoUpsert> {
  const e164 = normalizarE164(dados.telefone)
  const agora = new Date().toISOString()

  // 1. Já existe lead ATIVO (não-terminal) para este telefone? → atualiza.
  const { data: leadsAtivos } = await admin
    .from('funil_leads')
    .select('id, telefone')
    .eq('tenant_id', tenantId)
    .not('etapa', 'in', '(contrato_fechado,perdido)')
  const leadAtivo = (leadsAtivos ?? []).find((l) => mesmoTelefone(l.telefone as string, e164))
  if (leadAtivo) {
    const patch: Record<string, unknown> = { ultimo_contato_em: agora, updated_at: agora, ...patchUltimaMensagem(dados) }
    if (dados.nomeInformado) patch.nome_informado = dados.nomeInformado
    if (dados.email) patch.email = dados.email
    await admin.from('funil_leads').update(patch).eq('id', leadAtivo.id)
    return { leadId: leadAtivo.id as string, novo: false, clienteExistente: false }
  }

  // 2. Vincula a cliente existente (retorno/indicação) ou cria pré-cadastro.
  const { data: clientes } = await admin
    .from('clientes')
    .select('id, telefone')
    .eq('tenant_id', tenantId)
    .is('deleted_at', null)
    .not('telefone', 'is', null)
  let clienteId = (clientes ?? []).find((c) => mesmoTelefone(c.telefone as string, e164))?.id as string | undefined
  const clienteExistente = !!clienteId

  if (!clienteId) {
    const { data: novoCliente, error } = await admin
      .from('clientes')
      .insert({
        tenant_id: tenantId,
        nome: dados.nomeInformado?.trim() || 'Lead (sem nome)',
        telefone: e164,
        status_cadastro: 'pre_cadastro',
        origem: 'atendimento-whatsapp',
      })
      .select('id')
      .single()
    if (error || !novoCliente) throw new Error(`falha ao criar pré-cadastro: ${error?.message}`)
    clienteId = novoCliente.id as string
  }

  // 3. Cria o lead vinculado ao cliente.
  const etapa = dados.etapaInicial ?? 'novo_lead'
  const { data: lead, error: leadErr } = await admin
    .from('funil_leads')
    .insert({
      tenant_id: tenantId,
      cliente_id: clienteId,
      nome_informado: dados.nomeInformado ?? null,
      telefone: e164,
      email: dados.email ?? null,
      unidade: dados.unidade || process.env.FUNIL_UNIDADE_DEFAULT || 'SC',
      etapa,
      ultimo_contato_em: agora,
      chatwoot_conversation_id: dados.chatwootConversationId ?? null,
      ...patchUltimaMensagem(dados),
    })
    .select('id')
    .single()
  if (leadErr || !lead) throw new Error(`falha ao criar lead: ${leadErr?.message}`)

  await registrarEvento(admin, lead.id as string, null, etapa, dados.ator ?? 'ia', null, 'Lead criado')
  return { leadId: lead.id as string, novo: true, clienteExistente }
}

/** Registra um evento na trilha do lead (auditoria + métricas de tempo). */
export async function registrarEvento(
  admin: SupabaseClient,
  leadId: string,
  deEtapa: EtapaFunil | null,
  paraEtapa: EtapaFunil,
  ator: AtorMovimentacao,
  atorNome: string | null,
  observacao: string | null,
): Promise<void> {
  await admin.from('funil_lead_eventos').insert({
    lead_id: leadId,
    de_etapa: deEtapa,
    para_etapa: paraEtapa,
    ator,
    ator_nome: atorNome,
    observacao,
  })
}
