// Recebimento AUTOMÁTICO de comprovante (SERVER-ONLY). Disparado pelo webhook
// do Chatwoot a cada mensagem de ENTRADA com anexo imagem/PDF. Se o telefone
// casa com um cliente com parcela aberta, roda a MESMA extração IA e — casando
// com UMA parcela — grava um "comprovante pendente" (staging). Quando a imagem
// É comprovante mas NÃO há cobrança correspondente (cliente sem parcela aberta,
// nenhuma parcela casou, claim perdido, ou telefone sem cliente), cria um
// registro no INBOX (comprovantes_recebidos) para o atendente conferir e
// atribuir a um contrato/cliente — em vez de descartar em silêncio.
// INVARIANTE DURA: NUNCA dá baixa; só pré-organiza para conferência humana.
// O webhook não pode 500 por isso: esta função NUNCA lança.
// LGPD: logger/logAudit só com ids e contagens — nunca valores/nomes/textos.

import { createClient as createAdminClient, type SupabaseClient } from '@supabase/supabase-js'
import { logger } from '@/lib/logger'
import { logAudit } from '@/lib/audit'
import { relayFetchBinario } from '@/lib/conversas/relay'
import { apenasDigitos, mesmoTelefone } from '@/lib/conversas/telefone'
import { extrairDadosComprovante } from '@/lib/financeiro/extracao'
import { sugerirParcela, type DadosComprovante } from '@/lib/financeiro/comprovante'

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
// o comprovante nunca casar. Em erro de página retorna null (aborta — uma lista
// parcial poderia mascarar um telefone multi-tenant e vazar dados).
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

// CASO (d): telefone não casa nenhum cliente. Sem cliente não há tenant pelo
// caminho normal — resolvemos pelo ÚNICO escritório com Pix configurado
// (config.financeiro.pix_chave). Com 0 ou >1 escritórios não dá para saber a
// quem o comprovante pertence → null (descarta; multi-tenant real vira
// mapeamento por inbox no futuro). Erro de query → null.
async function tenantUnicoComPix(db: SupabaseClient): Promise<string | null> {
  const { data, error } = await db
    .from('tenants')
    .select('id')
    .not('config->financeiro->>pix_chave', 'is', null)
    .limit(2)
  if (error || !data || data.length !== 1) return null
  return data[0].id as string
}

// Dedup do INBOX (complementa a UNIQUE (tenant_id, mensagem_id)): evita
// re-baixar/re-rodar IA numa REENTREGA do webhook de um comprovante que já foi
// para o inbox (a dedup por parcelas não o pega, pois inbox nunca stageia).
async function inboxJaRegistrado(
  db: SupabaseClient,
  tenantId: string,
  mensagemId: string,
): Promise<boolean> {
  const { data } = await db
    .from('comprovantes_recebidos')
    .select('id')
    .eq('tenant_id', tenantId)
    .eq('mensagem_id', mensagemId)
    .limit(1)
    .maybeSingle()
  return !!data
}

// DEDUP por endToEndId (E2E do Pix): o MESMO comprovante REENVIADO em mensagens
// diferentes tem mensagem_id distinto — a UNIQUE (tenant_id, mensagem_id) NÃO o
// pega —, mas o endToEndId é único por transação Pix. Só dá para checar DEPOIS
// da extração (o e2e nasce na leitura da IA); por isso roda após baixarEExtrair
// e ANTES de qualquer upload/insert/staging. Procura o mesmo e2e não-vazio já no
// inbox (QUALQUER status) OU já grudado numa parcela (staging ativo). Achou =>
// é reenvio do mesmo comprovante, ignora. Erro de query => false (não descarta
// por falha transitória). LGPD: sem valores — só a existência.
async function duplicadoPorEndToEnd(
  db: SupabaseClient,
  tenantId: string,
  endToEndId: string,
): Promise<boolean> {
  const [inbox, staging] = await Promise.all([
    db
      .from('comprovantes_recebidos')
      .select('id')
      .eq('tenant_id', tenantId)
      .eq('dados->>endToEndId', endToEndId)
      .limit(1)
      .maybeSingle(),
    db
      .from('parcelas')
      .select('id')
      .eq('tenant_id', tenantId)
      .eq('comprovante_recebido_dados->>endToEndId', endToEndId)
      .limit(1)
      .maybeSingle(),
  ])
  return !!inbox.data || !!staging.data
}

// Baixa os bytes do anexo pelo relay e roda a MESMA extração IA da rota manual.
// Devolve null (e loga) em qualquer falha OU quando a imagem NÃO é comprovante —
// nunca lança. Compartilhado pelo fluxo com cliente casado e pelo inbox sem
// cliente. Só é chamada depois dos dedups (evita gastar IA à toa).
async function baixarEExtrair(input: {
  anexoUrl: string
  mensagemId: string
  conversaId: string
  tenantId: string
  contentTypeHint?: string | null
}): Promise<{ buffer: Buffer; contentType: string; dados: DadosComprovante } | null> {
  const { anexoUrl, mensagemId, conversaId, tenantId } = input
  const anexo = await relayFetchBinario('/attachments', {
    email: RELAY_EMAIL_SERVICO,
    query: { url: anexoUrl },
  })
  if (anexo.status < 200 || anexo.status >= 300 || !anexo.buffer) {
    logger.warn('financeiro.recebimento.anexo_falhou', { mensagemId, conversaId, tenantId, status: anexo.status })
    return null
  }
  const contentType = (anexo.contentType ?? input.contentTypeHint ?? '')
    .split(';')[0]
    .trim()
    .toLowerCase()
  // Foto qualquer / tipo não suportado NÃO é erro — só ignora (fluxo manual segue).
  const extracao = await extrairDadosComprovante({ buffer: anexo.buffer, contentType })
  if (!extracao.ok) {
    logger.info('financeiro.recebimento.ignorado', { mensagemId, conversaId, tenantId, motivo: extracao.motivo })
    return null
  }
  return { buffer: anexo.buffer, contentType, dados: extracao.dados }
}

// Cria o registro de INBOX quando a imagem É comprovante mas não houve staging
// automático (casos a–d). Sobe o arquivo em financeiro/<tenantId>/inbox/
// <mensagemId>.<ext>, insere com ON CONFLICT (tenant_id, mensagem_id) DO NOTHING
// (reentrega do webhook não duplica) e audita só ids. NUNCA lança.
async function registrarComprovanteInbox(input: {
  db: SupabaseClient
  tenantId: string
  clienteId: string | null
  telefone: string
  conversaId: string
  mensagemId: string
  dados: DadosComprovante
  buffer: Buffer
  contentType: string
}): Promise<void> {
  const { db, tenantId, clienteId, telefone, conversaId, mensagemId, dados, buffer, contentType } = input
  try {
    const ext = EXTENSOES[contentType] ?? 'bin'
    const path = `financeiro/${tenantId}/inbox/${mensagemId}.${ext}`
    const { error: upErr } = await db.storage
      .from('documentos')
      .upload(path, buffer, { contentType, upsert: true })
    if (upErr) {
      logger.warn('financeiro.inbox.upload_falhou', { mensagemId, conversaId, tenantId })
      return // sem arquivo não grava o registro
    }

    // ON CONFLICT (tenant_id, mensagem_id) DO NOTHING: reentrega do webhook não
    // duplica. .select() devolve [] quando nada foi inserido (já existia).
    const { data: inseridos, error: insErr } = await db
      .from('comprovantes_recebidos')
      .upsert(
        {
          tenant_id: tenantId,
          cliente_id: clienteId,
          telefone,
          conversa_id: conversaId,
          mensagem_id: mensagemId,
          dados,
          arquivo_url: path,
          content_type: contentType,
          status: 'pendente',
        },
        { onConflict: 'tenant_id,mensagem_id', ignoreDuplicates: true },
      )
      .select('id')
    if (insErr) {
      logger.warn('financeiro.inbox.insert_falhou', { mensagemId, conversaId, tenantId })
      return
    }

    if (!inseridos || inseridos.length === 0) {
      // Já existia registro para (tenant, mensagem). Remove o arquivo recém-subido
      // para não orfanar — MAS só se apontar para path DIFERENTE do já gravado
      // (path é determinístico por mensagemId, então normalmente coincide e NÃO
      // podemos apagar o arquivo do registro existente).
      const { data: existente } = await db
        .from('comprovantes_recebidos')
        .select('arquivo_url')
        .eq('tenant_id', tenantId)
        .eq('mensagem_id', mensagemId)
        .maybeSingle()
      if (!existente || existente.arquivo_url !== path) {
        await db.storage.from('documentos').remove([path]).catch(() => {})
      }
      logger.info('financeiro.inbox.duplicado', { mensagemId, conversaId, tenantId })
      return
    }

    await logAudit({
      tenantId,
      userId: null,
      action: 'financeiro.comprovante_inbox_criado',
      resourceType: 'comprovante_recebido',
      resourceId: inseridos[0].id as string,
      metadata: { conversaId, mensagemId, comCliente: !!clienteId },
    })
    logger.info('financeiro.inbox.criado', { mensagemId, conversaId, tenantId })
  } catch (err) {
    logger.error('financeiro.inbox.erro', { mensagemId, conversaId }, err)
  }
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

    // d) TELEFONE NÃO CASA NENHUM CLIENTE → INBOX sem cliente. Resolve o tenant
    // pela heurística do único escritório com Pix; ambíguo/inexistente descarta.
    // Só baixa/roda IA se ainda não há registro de inbox p/ esta mensagem.
    if (casados.length === 0) {
      const tenantId = await tenantUnicoComPix(db)
      if (!tenantId) {
        logger.warn('financeiro.recebimento.sem_tenant', { mensagemId, conversaId })
        return
      }
      if (await inboxJaRegistrado(db, tenantId, mensagemId)) return
      const extraido = await baixarEExtrair({
        anexoUrl, mensagemId, conversaId, tenantId, contentTypeHint: input.contentTypeHint,
      })
      if (!extraido) return
      // Dedup por E2E: reenvio do mesmo comprovante em nova mensagem → ignora.
      if (extraido.dados.endToEndId && await duplicadoPorEndToEnd(db, tenantId, extraido.dados.endToEndId)) {
        logger.info('financeiro.inbox.duplicado_e2e', { mensagemId, conversaId, tenantId })
        return
      }
      await registrarComprovanteInbox({
        db, tenantId, clienteId: null, telefone: input.telefone, conversaId, mensagemId,
        dados: extraido.dados, buffer: extraido.buffer, contentType: extraido.contentType,
      })
      return
    }

    // e) Telefone de MAIS DE UM tenant: não dá para saber o escritório — NÃO faz
    // staging NEM inbox (evita vazamento cross-tenant). Fluxo manual resolve.
    const tenants = new Set(casados.map((c) => c.tenant_id))
    if (tenants.size > 1) {
      logger.info('financeiro.recebimento.telefone_multi_tenant', {
        mensagemId, conversaId, tenants: tenants.size,
      })
      return
    }
    const tenantId = casados[0].tenant_id
    const clienteIds = [...new Set(casados.map((c) => c.id))]
    // Palpite de cliente para o inbox: só quando o telefone é de UM cliente
    // (cônjuges/duplicados que dividem o telefone → null, o atendente decide).
    const clienteIdHint = clienteIds.length === 1 ? clienteIds[0] : null

    // f) Parcelas abertas de TODOS os clientes casados nesse tenant (cônjuges/
    // duplicados que dividem o telefone) — avaliadas EM CONJUNTO para a sugestão.
    // NÃO retorna se vazio: cliente casado sem parcela aberta ainda gera inbox
    // (caso a) se a imagem for comprovante.
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

    // g) DEDUP do webhook, ANTES de gastar IA: (1) alguma parcela do tenant já
    // carrega este mensagemId (staging ativo OU tombstone de baixa/cancelamento);
    // (2) ou o comprovante já foi para o inbox (reentrega). Qualquer um → não
    // reprocessa.
    const { data: jaProcessado } = await db
      .from('parcelas')
      .select('id')
      .eq('tenant_id', tenantId)
      .eq('comprovante_recebido_dados->>mensagemId', mensagemId)
      .limit(1)
      .maybeSingle()
    if (jaProcessado) return
    if (await inboxJaRegistrado(db, tenantId, mensagemId)) return

    // h) Bytes do anexo + extração IA (mesma da rota manual). Só chega aqui se
    // não é duplicado — evita gastar IA à toa. Não-comprovante → null → silêncio.
    const extraido = await baixarEExtrair({
      anexoUrl, mensagemId, conversaId, tenantId, contentTypeHint: input.contentTypeHint,
    })
    if (!extraido) return
    const { buffer, contentType, dados } = extraido

    // h.1) DEDUP por E2E, ANTES de qualquer upload/insert/staging: o mesmo
    // comprovante reenviado em nova mensagem (mensagem_id diferente) já foi para
    // o inbox ou já grudou numa parcela → ignora (vale para os caminhos a/b e o
    // staging abaixo). Só possível aqui porque o e2e só existe após a extração.
    if (dados.endToEndId && await duplicadoPorEndToEnd(db, tenantId, dados.endToEndId)) {
      logger.info('financeiro.inbox.duplicado_e2e', { mensagemId, conversaId, tenantId })
      return
    }

    // i) CASO (a) — cliente casado SEM parcela aberta: vai para o inbox.
    if (!abertas || abertas.length === 0) {
      await registrarComprovanteInbox({
        db, tenantId, clienteId: clienteIdHint, telefone: input.telefone, conversaId, mensagemId,
        dados, buffer, contentType,
      })
      return
    }

    // j) Sugere a parcela sobre TODAS as abertas. CASO (b) — nenhuma casou
    // (sugestão null): vai para o inbox (o atendente atribui à cobrança certa).
    const sugestao = sugerirParcela(dados, abertas)
    if (!sugestao) {
      logger.info('financeiro.recebimento.sem_sugestao', { mensagemId, conversaId, tenantId, abertas: abertas.length })
      await registrarComprovanteInbox({
        db, tenantId, clienteId: clienteIdHint, telefone: input.telefone, conversaId, mensagemId,
        dados, buffer, contentType,
      })
      return
    }

    // k) Grava os bytes no bucket privado ANTES do claim (mensagemId no path
    // torna-o único por mensagem; upsert cobre reentrega do webhook).
    const ext = EXTENSOES[contentType] ?? 'bin'
    const path = `financeiro/${tenantId}/pendentes/${sugestao.id}-${mensagemId}.${ext}`
    const { error: upErr } = await db.storage
      .from('documentos')
      .upload(path, buffer, { contentType, upsert: true })
    if (upErr) {
      logger.warn('financeiro.recebimento.upload_falhou', { mensagemId, conversaId, tenantId })
      return // sem arquivo não grava staging
    }

    // l) CLAIM ATÔMICO: só marca o staging se a parcela seguir aberta e SEM
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
      // CASO (c) — CLAIM PERDIDO: a parcela sugerida já tinha pendente (outra
      // entrega/outro comprovante venceu) ou saiu de 'aberta'. Este comprovante
      // não tem cobrança livre → vai para o INBOX (sobe novo arquivo no path do
      // inbox a partir do buffer). EXCEÇÃO: se quem venceu foi a PRÓPRIA mensagem
      // (corrida de reentrega concorrente da MESMA mensagem), não inboxa — já
      // está staged/baixado por ela.
      const { data: cur } = await db
        .from('parcelas')
        .select('comprovante_recebido_url, comprovante_url, comprovante_recebido_dados')
        .eq('id', sugestao.id)
        .eq('tenant_id', tenantId)
        .maybeSingle()

      const curDados = (cur?.comprovante_recebido_dados ?? {}) as Record<string, unknown>
      if (curDados.mensagemId !== mensagemId) {
        await registrarComprovanteInbox({
          db, tenantId, clienteId: clienteIdHint, telefone: input.telefone, conversaId, mensagemId,
          dados, buffer, contentType,
        })
      }

      // Limpeza do pendentes/ (mantida): o path é determinístico por (parcela,
      // mensagemId); uma entrega concorrente da MESMA mensagem subiu no MESMO
      // objeto — só removemos se NINGUÉM o referencia (nem o staging que venceu
      // a corrida, nem uma baixa que o adotou como comprovante oficial).
      const referenciado = !!cur && (cur.comprovante_recebido_url === path || cur.comprovante_url === path)
      if (!referenciado) {
        await db.storage.from('documentos').remove([path]).catch(() => {})
      }
      logger.info('financeiro.recebimento.claim_perdido', { mensagemId, conversaId, tenantId })
      return
    }

    // m) Auditoria — sem valores/nomes, só ids de rastreio.
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
