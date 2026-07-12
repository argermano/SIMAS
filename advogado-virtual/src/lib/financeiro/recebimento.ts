// Recebimento AUTOMÁTICO de comprovante (SERVER-ONLY). Disparado pelo webhook
// do Chatwoot a cada mensagem de ENTRADA com anexo imagem/PDF: se o telefone
// casa com um cliente que tem parcela aberta, baixa o anexo, roda a MESMA
// extração IA e — casando com UMA parcela — grava um "comprovante pendente"
// (staging). INVARIANTE DURA: NUNCA dá baixa; só pré-organiza para conferência
// humana na /financeiro. O webhook não pode 500 por isso: esta função NUNCA lança.
// LGPD: logger/logAudit só com ids e contagens — nunca valores/nomes/textos.

import { createClient as createAdminClient, type SupabaseClient } from '@supabase/supabase-js'
import { logger } from '@/lib/logger'
import { logAudit } from '@/lib/audit'
import { relayFetchBinario } from '@/lib/conversas/relay'
import { apenasDigitos, mesmoTelefone } from '@/lib/conversas/telefone'
import { extrairDadosComprovante } from '@/lib/financeiro/extracao'
import { sugerirParcela } from '@/lib/financeiro/comprovante'

// Mesmo mapa de extensões da rota de baixa manual (contentType → sufixo do path).
const EXTENSOES: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'application/pdf': 'pdf',
}

// O relay identifica o solicitante pelo X-Simas-User-Email; num webhook não há
// agente logado — usa uma identidade de serviço fixa do módulo financeiro.
const RELAY_EMAIL_SERVICO = 'financeiro@simas.app'

// Página da varredura de clientes: acima do teto implícito de 1000 linhas do
// PostgREST, uma query sem range descartaria silenciosamente clientes.
const PAGINA_CLIENTES = 1000

function admin() {
  return createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )
}

// Defesa em profundidade (paridade com a rota manual, z.string().url().max(2000)):
// o data_url do anexo vem do webhook sem validação. Só http/https absolutos e
// tamanho limitado passam para o relay (barreira própria contra SSRF, além da
// allowlist do relay).
function urlAnexoValida(u: string): boolean {
  if (!u || u.length > 2000) return false
  try {
    const parsed = new URL(u)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:'
  } catch {
    return false
  }
}

interface ClienteCasado {
  id: string
  tenant_id: string
}

// Varre os clientes de TODOS os tenants (webhook global) e devolve os que casam
// pelo telefone. PAGINADO: o teto de 1000 linhas do PostgREST descartaria os
// clientes além dessa linha (produção já tem >1.800 num único tenant), fazendo
// o comprovante nunca casar. Em erro de página retorna null (aborta o staging —
// uma lista parcial poderia mascarar um telefone multi-tenant e vazar dados).
// LGPD: carrega só id/telefone/tenant_id, nunca nome.
async function clientesCasadosPorTelefone(
  db: SupabaseClient,
  telefone: string,
): Promise<ClienteCasado[] | null> {
  const casados: ClienteCasado[] = []
  for (let offset = 0; ; offset += PAGINA_CLIENTES) {
    const { data, error } = await db
      .from('clientes')
      .select('id, telefone, tenant_id')
      .is('deleted_at', null)
      .not('telefone', 'is', null)
      .order('id', { ascending: true })
      .range(offset, offset + PAGINA_CLIENTES - 1)
    if (error) return null
    const lote = data ?? []
    for (const c of lote) {
      if (mesmoTelefone(c.telefone as string, telefone)) {
        casados.push({ id: c.id as string, tenant_id: c.tenant_id as string })
      }
    }
    if (lote.length < PAGINA_CLIENTES) break
  }
  return casados
}

export async function processarAnexoRecebido(input: {
  telefone: string
  anexoUrl: string
  mensagemId: string
  conversaId: string
  contentTypeHint?: string | null
}): Promise<void> {
  const { anexoUrl, mensagemId, conversaId } = input

  try {
    // a) Normaliza o telefone; sem dígitos não há como casar cliente.
    const digitos = apenasDigitos(input.telefone)
    if (!digitos) return

    // b) Valida a URL do anexo ANTES de tocar no relay (defesa SSRF).
    if (!urlAnexoValida(anexoUrl)) {
      logger.warn('financeiro.recebimento.url_invalida', { mensagemId, conversaId })
      return
    }

    const db = admin()

    // c) Clientes que casam pelo telefone (todos os tenants, paginado).
    const casados = await clientesCasadosPorTelefone(db, input.telefone)
    if (casados === null) {
      logger.error('financeiro.recebimento.clientes_falhou', { mensagemId, conversaId })
      return
    }
    if (casados.length === 0) return // telefone desconhecido — silêncio

    // d) Se o telefone pertence a clientes de MAIS DE UM tenant, não há como
    // saber a qual escritório o pagamento se refere — NÃO faz staging (evita
    // vazamento cross-tenant do comprovante). O fluxo manual, por agente logado
    // e escopado ao tenant, continua resolvendo esses casos raros.
    const tenants = new Set(casados.map((c) => c.tenant_id))
    if (tenants.size > 1) {
      logger.info('financeiro.recebimento.telefone_multi_tenant', {
        mensagemId, conversaId, tenants: tenants.size,
      })
      return
    }
    const tenantId = casados[0].tenant_id
    const clienteIds = [...new Set(casados.map((c) => c.id))]

    // e) Parcelas abertas de TODOS os clientes casados nesse tenant (cônjuges/
    // duplicados que dividem o telefone) — avaliadas EM CONJUNTO para a sugestão.
    const { data: abertas, error: erroParcelas } = await db
      .from('parcelas')
      .select('id, valor_centavos, vencimento')
      .eq('tenant_id', tenantId)
      .in('cliente_id', clienteIds)
      .eq('status', 'aberta')
      .order('vencimento', { ascending: true })
    if (erroParcelas) {
      logger.error('financeiro.recebimento.parcelas_falhou', { mensagemId, conversaId, tenantId })
      return
    }
    if (!abertas || abertas.length === 0) return

    // f) DEDUP do webhook: se alguma parcela do tenant já carrega este mensagemId
    // (staging ativo OU tombstone deixado por baixa/cancelamento/descarte),
    // o anexo já foi processado — não reprocessa (poupa IA e evita re-staging).
    const { data: jaProcessado } = await db
      .from('parcelas')
      .select('id')
      .eq('tenant_id', tenantId)
      .eq('comprovante_recebido_dados->>mensagemId', mensagemId)
      .limit(1)
      .maybeSingle()
    if (jaProcessado) return

    // g) Bytes do anexo via relay (server-only). Só chega aqui se há parcela
    // aberta e não é duplicado — evita gastar IA à toa.
    const anexo = await relayFetchBinario('/attachments', {
      email: RELAY_EMAIL_SERVICO,
      query: { url: anexoUrl },
    })
    if (anexo.status < 200 || anexo.status >= 300 || !anexo.buffer) {
      logger.warn('financeiro.recebimento.anexo_falhou', {
        mensagemId, conversaId, tenantId, status: anexo.status,
      })
      return
    }

    const contentType = (anexo.contentType ?? input.contentTypeHint ?? '')
      .split(';')[0]
      .trim()
      .toLowerCase()

    // h) Mesma extração IA da rota manual. Foto qualquer / tipo não suportado
    // NÃO é erro — só ignora silenciosamente (o fluxo manual continua existindo).
    const extracao = await extrairDadosComprovante({ buffer: anexo.buffer, contentType })
    if (!extracao.ok) {
      logger.info('financeiro.recebimento.ignorado', {
        mensagemId, conversaId, tenantId, motivo: extracao.motivo,
      })
      return
    }
    const dados = extracao.dados

    // i) Sugere a parcela sobre TODAS as abertas dos clientes casados; ambíguo/
    // sem casamento fica para o fluxo manual.
    const sugestao = sugerirParcela(dados, abertas)
    if (!sugestao) {
      logger.info('financeiro.recebimento.sem_sugestao', {
        mensagemId, conversaId, tenantId, abertas: abertas.length,
      })
      return
    }

    // j) Grava os bytes no bucket privado ANTES do claim (mensagemId no path
    // torna-o único por mensagem; upsert cobre reentrega do webhook).
    const ext = EXTENSOES[contentType] ?? 'bin'
    const path = `financeiro/${tenantId}/pendentes/${sugestao.id}-${mensagemId}.${ext}`
    const { error: upErr } = await db.storage
      .from('documentos')
      .upload(path, anexo.buffer, { contentType, upsert: true })
    if (upErr) {
      logger.warn('financeiro.recebimento.upload_falhou', { mensagemId, conversaId, tenantId })
      return // sem arquivo não grava staging
    }

    // k) CLAIM ATÔMICO: só marca o staging se a parcela seguir aberta e SEM
    // comprovante recebido (evita corrida entre webhooks concorrentes).
    const { data: reclamadas, error: erroClaim } = await db
      .from('parcelas')
      .update({
        comprovante_recebido_em: new Date().toISOString(),
        comprovante_recebido_url: path,
        comprovante_recebido_dados: { ...dados, mensagemId, conversaId, contentType },
      })
      .eq('id', sugestao.id)
      .eq('tenant_id', tenantId)
      .eq('status', 'aberta')
      .is('comprovante_recebido_em', null)
      .select('id')

    if (erroClaim || !reclamadas || reclamadas.length === 0) {
      // Perdeu a corrida (ou já tinha comprovante). O path é determinístico por
      // (parcela, mensagemId): uma entrega concorrente da MESMA mensagem sobe no
      // MESMO objeto — só removemos se NINGUÉM o referencia (nem o staging que
      // venceu a corrida, nem uma baixa que o adotou como comprovante oficial).
      const { data: cur } = await db
        .from('parcelas')
        .select('comprovante_recebido_url, comprovante_url')
        .eq('id', sugestao.id)
        .eq('tenant_id', tenantId)
        .maybeSingle()
      const referenciado = !!cur && (cur.comprovante_recebido_url === path || cur.comprovante_url === path)
      if (!referenciado) {
        await db.storage.from('documentos').remove([path]).catch(() => {})
      }
      logger.info('financeiro.recebimento.claim_perdido', { mensagemId, conversaId, tenantId })
      return
    }

    // l) Auditoria — sem valores/nomes, só ids de rastreio.
    await logAudit({
      tenantId,
      userId: null,
      action: 'financeiro.comprovante_recebido',
      resourceType: 'parcela',
      resourceId: sugestao.id,
      metadata: { conversaId, mensagemId },
    })

    logger.info('financeiro.recebimento.staged', { mensagemId, conversaId, tenantId })
  } catch (err) {
    // O webhook não pode 500 por causa do staging — engole e loga só ids.
    logger.error('financeiro.recebimento.erro', { mensagemId, conversaId }, err)
  }
}
